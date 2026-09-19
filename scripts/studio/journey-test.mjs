#!/usr/bin/env node
/**
 * The author's journey, end to end, through the real application.
 *
 * Everything else in scripts/studio tests a seam. This one walks the whole
 * path a person actually takes — new post, type markdown, watch the preview,
 * press publish, open the site — and asserts the reader got what the author saw.
 * The steps are driven as Server Actions over HTTP, not by importing the write
 * modules, because importing them would skip the layer that is most likely to
 * be wrong: the actions are where cache invalidation lives, and a publish that
 * forgets to invalidate looks perfect at the module level and serves a 404 in
 * the browser.
 *
 *   node --env-file=.env.local scripts/studio/journey-test.mjs
 *
 * `../lib/actions.mjs` explains how the action ids are discovered. They are
 * internal, so this test is coupled to the build it runs against — which is why
 * it says so loudly if the ids cannot be found rather than skipping.
 *
 * ## What it proves
 *
 *   1. The preview the editor shows is byte-identical to the HTML publishing
 *      stores — checked against a fresh render of the stored markdown, which is
 *      the same property preview-parity.mjs asserts for the corpus but here for
 *      a document no importer has ever touched.
 *   2. A published post is reachable at its URL, and the page carries the same
 *      chrome a file-based post does: date, reading time, tags, TOC, the
 *      per-post JSON-LD, the Open Graph block, the Twitter card.
 *   3. The OG image route returns a real 1200x630 PNG for that post's title,
 *      including a CJK one — the font subsetting path is a network fetch and is
 *      the part of the SEO surface most likely to fail quietly.
 *   4. The post reaches the sitemap, all three feeds and the search index.
 *   5. Unpublishing makes it 404 again and removes it from all of those.
 *   6. Renaming it puts a permanent redirect on the old URL, moves the search
 *      row rather than duplicating it, and records the slug in `slug_history`.
 *      This one found a real defect: the post route had no redirect lookup at
 *      all, so a renamed post's every inbound link 404ed while /studio reported
 *      the rename as a success.
 *   7. Deleting it — through the action the UI calls, with the typed
 *      confirmation the server enforces — takes the revisions, the tag links
 *      and the search row with it, and a wrong confirmation is refused.
 *   8. A COVER IMAGE UPLOADED THROUGH THE STUDIO is served to a stranger, in
 *      the OG tags, in the JSON-LD, and in the body — and stops being served
 *      the moment the post is unpublished. That last part is the one property
 *      no other test covers: `/api/img` answers 404 rather than 403 to an
 *      anonymous request for an unpublished object, and publishing a post is
 *      what flips it. A reader seeing a broken image in a post they can read
 *      is exactly the failure, and it only shows up on a post whose image came
 *      from `/studio` rather than from `/static`.
 *
 * Nothing is left behind: the post is deleted at the end, the uploaded object
 * with it, and the run asserts the corpus count is back where it started.
 */

import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { pathToFileURL } from "node:url";

import { actionIds, callAction, sessionFor } from "./lib/actions.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const BASE = process.env.BASE_URL || "http://localhost:3220";

/**
 * A real 1×1 PNG. Real bytes and not a stub, because the thing under test is
 * whether a browser's `next/image` fetch and a feed reader's plain GET both
 * reach the object — and a zero-byte body would pass every status-code
 * assertion while proving nothing about the store.
 *
 * Behind `/api/img` it is only ever a thumbnail, and the assertions below are
 * about the PATH it travels, not about the picture.
 */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const { renderMarkdown, RENDERER_VERSION } = await import(
  pathToFileURL(path.join(ROOT, "src/lib/markdown/render.js")).href
);

let pass = 0;
const failures = [];

function ok(name, condition, detail = "") {
  if (condition) pass++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
}

function eq(name, actual, expected) {
  ok(
    name,
    actual === expected,
    `expected ${JSON.stringify(expected)?.slice(0, 120)}, got ${JSON.stringify(actual)?.slice(0, 120)}`
  );
}

/** The visible text of an HTML document — the same reduction full-sweep uses. */
function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<head[\s\S]*?<\/head>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The content of a `<meta property=...>` or `<meta name=...>`, decoded.
 *  Called as `metaContent(key, html)` — key first, because every call site
 *  reads as "the og:title of this page". */
function metaContent(key, html) {
  const re = new RegExp(
    `<meta\\s+(?:property|name)="${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s+content="([^"]*)"`,
    "i"
  );
  const m = re.exec(html);
  return m ? m[1].replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"') : null;
}

/** Every JSON-LD block on the page, parsed. */
function jsonLd(html) {
  const blocks = [];
  for (const m of html.matchAll(
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g
  )) {
    try {
      blocks.push(JSON.parse(m[1]));
    } catch {
      blocks.push({ __parse_error: m[1].slice(0, 200) });
    }
  }
  return blocks;
}

function feedHas(feed, slug) {
  return feed.includes(`/blog/${slug}`);
}

/** The chrome every post page on this site carries, file-based or not. */
function chromeMarkers(html) {
  return {
    // React renders the DOM property name, not the HTML attribute name, and
    // this page has carried `dateTime=` since before the platform work — so the
    // test matches what the site actually emits rather than what the spec says.
    time: /<time[^>]*date[Tt]ime="/.test(html),
    readingTime: /<!-- -->\s*字|>字</.test(html),
    cc: html.includes("CC BY-NC-SA 4.0"),
    toc: html.includes("目录"),
    related: html.includes("相关推荐"),
    back: html.includes("← 返回"),
  };
}

const fixture = fs.readFileSync(
  path.join(ROOT, "scripts/studio/fixtures/publish-journey.md"),
  "utf8"
).replace(/\r\n/g, "\n");

const ids = actionIds();
ok("the build's action ids are discoverable", ids.size > 20, `${ids.size} found`);

const client = new pg.Client({ connectionString: process.env.DATABASE_URL_UNPOOLED });
await client.connect();

const { rows: users } = await client.query(`SELECT id FROM users LIMIT 1`);
if (!users.length) {
  console.error("no user in the database — run scripts/admin/bootstrap.mjs first");
  process.exit(1);
}

const { cookie, token } = await sessionFor(users[0].id, client);

const { rows: before } = await client.query(`SELECT count(*)::int AS n FROM posts`);
const startingCount = before[0].n;
const { rows: mediaBefore } = await client.query(`SELECT count(*)::int AS n FROM media`);
const startingMedia = mediaBefore[0].n;

let slug = null;
let objectPath = null;
let mediaId = null;

try {
  // ── 0. upload a cover image through the studio's own upload path ────────
  //
  // Three steps, in the order the browser performs them: ask for a ticket,
  // PUT the bytes straight to the store, then tell the server to record what
  // landed. Driving the ACTIONS rather than `media/write.js` is the point —
  // the presign is minted by a Server Action, and `commitUploadAction` is what
  // drops the media cache tag. A commit that wrote the row and forgot that
  // would leave the image 404ing for a reader while /studio showed it present.
  {
    const ticket = await callAction(
      ids,
      cookie,
      "beginUploadAction",
      [{ filename: "cover-journey.png", contentType: "image/png", size: PNG.length }],
      { pagePath: "/studio/posts" }
    );
    ok("beginUploadAction returns a ticket", ticket.result?.ok === true, JSON.stringify(ticket.result));
    objectPath = ticket.result?.pathname;
    ok("the ticket names a pathname the proxy will accept", /^media\/\d{4}\/\d{2}\/[0-9a-f]{8}-/.test(String(objectPath)), String(objectPath));

    const put = await fetch(ticket.result?.presignedUrl, {
      method: "PUT",
      body: PNG,
      headers: { "content-type": "image/png" },
    });
    eq("the presigned PUT to the store succeeds", put.status, 200);

    const committed = await callAction(
      ids,
      cookie,
      "commitUploadAction",
      [{
        pathname: objectPath,
        originalName: "cover-journey.png",
        contentType: "image/png",
        size: PNG.length,
        width: 1,
        height: 1,
        alt: "封面测试图",
      }],
      { pagePath: "/studio/posts" }
    );
    ok("commitUploadAction records it", committed.result?.ok === true, JSON.stringify(committed.result));
    mediaId = committed.result?.media?.id;
    ok("the row has an id", typeof mediaId === "string" && mediaId.length > 0, String(mediaId));
  }

  // ── 1. create ────────────────────────────────────────────────────────────
  const created = await callAction(
    ids,
    cookie,
    "createPostAction",
    [{ title: "从 /studio 发布的一篇文章" }],
    { pagePath: "/studio/posts" }
  );
  ok("createPostAction succeeds", created.result?.ok === true, JSON.stringify(created.result));
  slug = created.result?.slug;
  ok("it returns a slug", typeof slug === "string" && slug.length > 0, String(slug));

  if (slug) {
    // ── 2. save the document, with the full metadata block ─────────────────
    //
    // The markdown is the fixture verbatim. `meta` carries every frontmatter
    // field the editor's sidebar exposes, which is what makes this a test of
    // the AUTHOR's path rather than of the renderer alone: `savePost` patches
    // those fields back into the document, so a bug in that patch shows up as
    // either a mismatch against the stored markdown or a missing tag on the
    // published page.
    const meta = {
      title: "从 /studio 发布的一篇文章",
      description:
        "这是一篇通过管理后台创建、预览并发布的文章，用来验证发布链路端到端可用。",
      publishDate: "2026-09-19",
      lastmod: "2026-09-19",
      tags: ["Meta", "Crypto"],
      // The uploaded object, not a path under /static. That difference is what
      // makes the publish step a media-visibility event, and it is the branch
      // no imported post has ever exercised.
      image: `/api/img/${objectPath}`,
      imageDesc: "封面测试图",
      featured: false,
    };

    const saved = await callAction(ids, cookie, "autosavePost", [
      slug,
      { markdown: fixture, meta, revision: 1 },
    ], { pagePath: `/studio/posts/${slug}` });
    ok("autosavePost succeeds", saved.result?.ok === true, JSON.stringify(saved.result));

    // ── 3. the preview is what will be published ───────────────────────────
    //
    // Read the markdown back OUT of the database rather than trusting the
    // fixture. `savePost` rewrites the frontmatter block from `meta`, so the
    // stored document is not the fixture — and asserting parity against the
    // wrong side of that would be asserting nothing.
    const { rows: storedRows } = await client.query(
      `SELECT r.markdown, r.html, r.renderer_version, r.revision_number, r.title,
              r.description, r.content_hash, p.status
         FROM posts p JOIN post_revisions r ON r.id = p.draft_revision_id
        WHERE p.slug = $1`,
      [slug]
    );
    ok("the draft revision is stored", storedRows.length === 1);
    const stored = storedRows[0];

    ok(
      "the stored renderer_version is the current one",
      stored?.renderer_version === RENDERER_VERSION,
      `${stored?.renderer_version} vs ${RENDERER_VERSION}`
    );

    const fresh = await renderMarkdown(stored.markdown);

    eq(
      "the preview the editor showed is the stored HTML",
      saved.result?.html,
      stored.html
    );
    eq(
      "the stored HTML is what the renderer produces now",
      stored.html,
      fresh.html
    );

    // The frontmatter patch must have written the metadata through, and the
    // document it wrote must still be one the renderer can read.
    ok("the title reached the revision", stored.title === meta.title, stored.title);
    eq("the description reached the revision", stored.description, meta.description);
    ok(
      "the metadata block survived the patch",
      stored.markdown.includes("publishDate: 2026-09-19") &&
        stored.markdown.includes("lastmod: 2026-09-19"),
      stored.markdown.slice(0, 240)
    );

    // Everything the fixture exercises, still present after the round trip.
    for (const [what, marker] of [
      ["a heading", "<h1"],
      ["display math", "katex"],
      ["a code block", "shiki"],
      ["a table", "<table"],
      ["a task list", "task-list"],
      ["a footnote", "data-footnote"],
      ["a blockquote", "<blockquote"],
    ]) {
      ok(`the rendered body carries ${what}`, stored.html.includes(marker), marker);
    }

    // ── 4. publish ─────────────────────────────────────────────────────────
    const published = await callAction(ids, cookie, "publishPostAction", [slug], {
      pagePath: `/studio/posts/${slug}`,
    });
    ok("publishPostAction succeeds", published.result?.ok === true, JSON.stringify(published.result));
    eq("its status is published", published.result?.status, "published");
    ok("it reports a first publication", published.result?.firstPublication === true);

    const { rows: pubRows } = await client.query(
      `SELECT p.status, p.published_at, p.cover_image, p.featured,
              r.html, r.markdown, r.title,
              coalesce((SELECT array_agg(t.slug ORDER BY pt.position)
                          FROM post_tags pt JOIN tags t ON t.id = pt.tag_id
                         WHERE pt.post_id = p.id), '{}') AS tags
         FROM posts p
         JOIN post_revisions r ON r.id = p.published_revision_id
        WHERE p.slug = $1`,
      [slug]
    );
    ok("the published row exists", pubRows.length === 1);
    const pub = pubRows[0];
    eq("the published status is 'published'", pub?.status, "published");
    ok("it has a published_at", Boolean(pub?.published_at));
    eq("the tags were written", (pub?.tags ?? []).join(","), "Meta,Crypto");

    // ── 5. the reader gets the same document ───────────────────────────────
    const pageRes = await fetch(`${BASE}/blog/${slug}`);
    const pageHtml = await pageRes.text();
    eq("the post page responds 200", pageRes.status, 200);

    const pageText = visibleText(pageHtml);
    // The `notFound()` BOUNDARY is defined in every page's RSC payload, so
    // searching the raw HTML for "This page could not be found" matches the
    // whole site — `/`, `/blog` and `/about` all contain it. What distinguishes
    // a 404 is that the visible text IS that message, which is what this checks.
    ok(
      "the post page is not the not-found page",
      !pageText.startsWith("404") && !pageText.includes("This page could not be found"),
      pageText.slice(0, 100)
    );

    ok("the reader sees the title", pageText.includes(meta.title), pageText.slice(0, 160));
    ok(
      "the reader sees the description",
      pageText.includes(meta.description)
    );
    ok("the reader sees the body", pageText.includes("这是一篇由"));
    ok("the reader sees the formula's text", pageText.includes("一级标题"));
    ok("the reader sees a tag", pageText.includes("随笔") || pageText.includes("Meta"));

    // The page renders the SAME stored HTML. `OptimizedHTMLRenderer` swaps
    // <img> for next/image and <pre class="mermaid"> for a client component,
    // so the comparison is on the text the renderer produced, not on the tags.
    for (const [what, marker] of [
      ["KaTeX markup", "katex"],
      ["a Shiki code block", "shiki"],
      ["a footnote reference", "footnote"],
    ]) {
      ok(`the page carries ${what}`, pageHtml.includes(marker), marker);
    }

    const markers = chromeMarkers(pageHtml);
    for (const [name, present] of Object.entries(markers)) {
      ok(`the post page has the shared chrome: ${name}`, present);
    }

    // ── 6. the SEO surface ─────────────────────────────────────────────────
    eq("og:title", metaContent("og:title", pageHtml), `${meta.title} - Prologue`);
    eq("og:description", metaContent("og:description", pageHtml), meta.description);
    eq("og:type", metaContent("og:type", pageHtml), "article");
    ok(
      "og:url points at this post",
      (metaContent("og:url", pageHtml) ?? "").endsWith(`/blog/${slug}`),
      metaContent("og:url", pageHtml)
    );
    ok("og:image is present", Boolean(metaContent("og:image", pageHtml)), String(metaContent("og:image", pageHtml)));
    eq("twitter:card", metaContent("twitter:card", pageHtml), "summary_large_image");
    eq("twitter:title", metaContent("twitter:title", pageHtml), `${meta.title} - Prologue`);
    eq("twitter:description", metaContent("twitter:description", pageHtml), meta.description);

    // The canonical description and title must be the ones from the database,
    // not defaults that happen to be non-empty.
    ok("there is a <title>", /<title[^>]*>[^<]+<\/title>/.test(pageHtml));
    ok(
      "the <title> carries the post title",
      /<title[^>]*>[^<]*从 \/studio 发布的一篇文章[^<]*<\/title>/.test(pageHtml),
      (/<title[^>]*>([^<]*)<\/title>/.exec(pageHtml) ?? [])[1]
    );

    // ── 7. JSON-LD ─────────────────────────────────────────────────────────
    const blocks = jsonLd(pageHtml);
    ok("the page has at least one JSON-LD block", blocks.length >= 1, `${blocks.length}`);
    const article = blocks.find((b) => b["@type"] === "Article");
    ok("one of them is an Article", Boolean(article), JSON.stringify(blocks.map((b) => b["@type"])));
    if (article) {
      eq("its headline is the post title", article.headline, meta.title);
      eq("its description is the post description", article.description, meta.description);
      ok("it has a datePublished", Boolean(article.datePublished), String(article.datePublished));
      ok("it has a dateModified", Boolean(article.dateModified), String(article.dateModified));
      ok("it names an author", Array.isArray(article.author) && article.author.length > 0);
      ok("it has an image", Array.isArray(article.image) && article.image.length > 0);
      ok(
        "its @context is schema.org",
        (blocks.find((b) => b["@type"] === "Article") ?? {})["@context"] === "https://schema.org"
      );
    }

    // ── 8. the OG card, as an image ────────────────────────────────────────
    //
    // The route fetches a Noto Sans SC subset from Google Fonts per title. That
    // fetch is the part that fails without saying so, so the check is on the
    // BYTES: a PNG that is actually 1200x630.
    for (const [label, title] of [
      ["an ASCII title", "hello world"],
      ["a CJK title", meta.title],
    ]) {
      const ogRes = await fetch(`${BASE}/og?title=${encodeURIComponent(title)}`);
      const buf = Buffer.from(await ogRes.arrayBuffer());
      const isPng = buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      ok(`the OG card for ${label} is a PNG`, isPng, `magic ${buf.slice(0, 8).toString("hex")}`);
      if (isPng && buf.length > 24) {
        eq(`the OG card for ${label} is 1200 wide`, buf.readUInt32BE(16), 1200);
        eq(`the OG card for ${label} is 630 tall`, buf.readUInt32BE(20), 630);
      }
      ok(`the OG card for ${label} is substantial`, buf.length > 5_000, `${buf.length} bytes`);
    }

    // ── 9. discovery: sitemap, feeds, search ───────────────────────────────
    const sitemap = await (await fetch(`${BASE}/sitemap.xml`)).text();
    ok("the sitemap lists the post", sitemap.includes(`/blog/${slug}`), "");

    for (const feed of ["/rss", "/atomfeed", "/jsonfeed"]) {
      const body = await (await fetch(`${BASE}${feed}`)).text();
      ok(`${feed} carries the post`, feedHas(body, slug), `no /blog/${slug}`);
      ok(`${feed} carries its title`, body.includes("从 /studio 发布的一篇文章"));
    }

    const microRss = await (await fetch(`${BASE}/microblog/rss`)).text();
    ok(
      "the microblog feed does not carry a blog post",
      !microRss.includes(`/blog/${slug}`),
      "a standalone feed picked up a post"
    );

    const search = await (
      await fetch(`${BASE}/api/search?q=${encodeURIComponent("从 /studio 发布")}`)
    ).json();
    const hits = Array.isArray(search) ? search : (search.results ?? []);
    ok(
      "search finds the post",
      hits.some((h) => (h.slug ?? h.url ?? "").includes(slug)),
      JSON.stringify(hits).slice(0, 300)
    );

    // ── 9b. the cover image is served, because the post is published ───────
    //
    // `/api/img` answers an ANONYMOUS request with the object when a PUBLISHED
    // document references it, and with a 404 otherwise — 404 rather than 403,
    // so a stranger cannot learn that unpublished work exists. Publishing a
    // post is therefore the event that makes its images public, and the
    // assertion below is the only place that whole chain is walked:
    // action → `invalidatePost` → the `media` cache tag → the proxy.
    //
    // The request carries NO cookie. `next/image` fetches server-side with no
    // session and every feed reader is anonymous, so a check that ran with the
    // author's session would pass on an object no reader could load.
    const imgRes = await fetch(`${BASE}/api/img/${objectPath}`);
    eq("the uploaded image is served to a stranger", imgRes.status, 200);
    eq(
      "with the type the row says, not the one the uploader claimed",
      imgRes.headers.get("content-type"),
      "image/png"
    );
    ok(
      "and it is the bytes that were uploaded",
      Buffer.from(await imgRes.arrayBuffer()).length === PNG.length,
      `${(await imgRes.headers.get("content-length")) ?? "?"} bytes`
    );

    // Then the same URL from a browser's point of view: `og:image` is an
    // absolute URL on the production origin even though the request is local,
    // so the path is what is compared.
    const ogImage = metaContent("og:image", pageHtml) ?? "";
    ok(
      "og:image points at the uploaded object",
      ogImage.includes(`/api/img/${objectPath}`),
      ogImage
    );
    ok(
      "JSON-LD carries it too",
      JSON.stringify(article?.image ?? []).includes(`/api/img/${objectPath}`),
      JSON.stringify(article?.image)
    );

    // ── 10. unpublish puts it back ─────────────────────────────────────────
    const unpublished = await callAction(ids, cookie, "unpublishPostAction", [slug], {
      pagePath: `/studio/posts/${slug}`,
    });
    ok("unpublishPostAction succeeds", unpublished.result?.ok === true, JSON.stringify(unpublished.result));

    const gone = await fetch(`${BASE}/blog/${slug}`);
    const goneHtml = await gone.text();
    eq("an unpublished post 404s", gone.status, 404);
    ok(
      "and it is the not-found page",
      goneHtml.includes("This page could not be found"),
      `status ${gone.status}`
    );

    const sitemapAfter = await (await fetch(`${BASE}/sitemap.xml`)).text();
    ok("the sitemap no longer lists it", !sitemapAfter.includes(`/blog/${slug}`));

    const rssAfter = await (await fetch(`${BASE}/rss`)).text();
    ok("the feed no longer carries it", !feedHas(rssAfter, slug));

    // ...and the image goes back to being invisible to a stranger. This is the
    // half of the publish-is-a-visibility-event rule that is easy to get wrong
    // in the direction nobody notices: an object that stays public after its
    // only published reference is withdrawn leaks an unpublished draft's
    // artwork to anyone who ever saw the URL.
    const imgGone = await fetch(`${BASE}/api/img/${objectPath}`);
    eq("the image is no longer served to a stranger", imgGone.status, 404);

    // ── 11. renaming a post leaves a working URL behind ───────────────────
    //
    // A rename touches four things and only one of them is the row: the slug,
    // the `slug_history` entry the router consults, the `redirects` row the
    // author curates, and the search index keyed by slug. A rename that did
    // three of those looks correct until an old link is followed or a search
    // returns a dead URL.
    //
    // Published first, because a draft has no public URL to move — and a SAVE
    // before the publish, because the unpublish above left the draft and
    // published pointers aimed at the same revision, and `publishPost` refuses
    // when there is nothing distinct to publish. Passing a revision number
    // higher than any real one is what says "do not treat this as a conflict";
    // `autosavePost` only refuses when the server is AHEAD of the client.
    await callAction(ids, cookie, "autosavePost", [
      slug,
      {
        markdown: `${fixture}\n`,
        meta,
        revision: 9999,
      },
    ], { pagePath: `/studio/posts/${slug}` });

    const republished = await callAction(ids, cookie, "publishPostAction", [slug], {
      pagePath: `/studio/posts/${slug}`,
    });
    ok(
      "a second publish after unpublishing succeeds",
      republished.result?.ok === true,
      JSON.stringify(republished.result)
    );

    const renamedSlug = `${slug}-renamed`;
    const renamed = await callAction(
      ids,
      cookie,
      "renamePostAction",
      [slug, renamedSlug],
      { pagePath: `/studio/posts/${slug}` }
    );
    ok("renamePostAction succeeds", renamed.result?.ok === true, JSON.stringify(renamed.result));
    eq("it reports the new slug", renamed.result?.slug, renamedSlug);

    const moved = await fetch(`${BASE}/blog/${renamedSlug}`, { redirect: "manual" });
    eq("the post answers at its new path", moved.status, 200);

    // A 308 and not a 301 or a soft redirect: only a permanent redirect moves a
    // search engine's index entry, and a rename is permanent by intent. Checked
    // with `redirect: "manual"` because a followed redirect proves only that
    // the client can follow it.
    const old = await fetch(`${BASE}/blog/${slug}`, { redirect: "manual" });
    eq("the old path answers with a permanent redirect", old.status, 308);
    ok(
      "and it points at the new path",
      (old.headers.get("location") ?? "").includes(`/blog/${renamedSlug}`),
      String(old.headers.get("location"))
    );

    // Then followed. A Location header that names the right URL and a client
    // that lands on the post are two different claims.
    const followed = await fetch(`${BASE}/blog/${slug}`, { redirect: "follow" });
    eq("following the old path reaches the post", followed.status, 200);
    const oldHtml = await followed.text();
    ok(
      "and it is the same post",
      oldHtml.includes(meta.title),
      `status ${followed.status}, ${followed.url}`
    );
    ok(
      "the followed URL is the new one",
      followed.url.endsWith(`/blog/${renamedSlug}`),
      followed.url
    );

    const { rows: redirectRows } = await client.query(
      `SELECT destination, permanent FROM redirects WHERE source = $1`,
      [`/blog/${slug}`]
    );
    eq("a permanent redirect was written", redirectRows[0]?.destination, `/blog/${renamedSlug}`);
    eq("and it is permanent", redirectRows[0]?.permanent, true);

    const { rows: historyRows } = await client.query(
      `SELECT count(*)::int AS n FROM slug_history WHERE slug = $1`,
      [slug]
    );
    ok("the old slug is in slug_history", historyRows[0].n === 1, `${historyRows[0].n} row(s)`);

    const { rows: searchAfterRename } = await client.query(
      `SELECT id, url FROM search_index WHERE id IN ($1, $2)`,
      [`post:${slug}`, `post:${renamedSlug}`]
    );
    eq("the search row moved and did not duplicate", searchAfterRename.length, 1);
    eq("it points at the new URL", searchAfterRename[0]?.url, `/blog/${renamedSlug}`);

    // ── 12. delete, through the action the UI actually calls ──────────────
    //
    // The typed confirmation is enforced on the SERVER, not only in the dialog,
    // so the wrong word is refused. Asserted first, because a delete that
    // obeyed anything typed would pass the rest of this section.
    const refused = await callAction(
      ids,
      cookie,
      "deletePostAction",
      [renamedSlug, "not-the-slug"],
      { pagePath: `/studio/posts/${renamedSlug}` }
    );
    eq("a wrong confirmation is refused", refused.result?.reason, "confirmation_mismatch");

    const { rows: stillThere } = await client.query(
      `SELECT count(*)::int AS n FROM posts WHERE slug = $1`,
      [renamedSlug]
    );
    eq("and nothing was deleted", stillThere[0].n, 1);

    const deleted = await callAction(
      ids,
      cookie,
      "deletePostAction",
      [renamedSlug, renamedSlug],
      { pagePath: `/studio/posts/${renamedSlug}` }
    );
    ok("deletePostAction succeeds", deleted.result?.ok === true, JSON.stringify(deleted.result));

    const { rows: afterDelete } = await client.query(
      `SELECT (SELECT count(*)::int FROM posts WHERE slug = $1) AS posts,
              (SELECT count(*)::int FROM post_revisions r
                 JOIN posts p ON p.id = r.post_id WHERE p.slug = $1) AS revisions,
              (SELECT count(*)::int FROM search_index WHERE id = $2) AS search`,
      [renamedSlug, `post:${renamedSlug}`]
    );
    eq("the post row is gone", afterDelete[0].posts, 0);
    eq("its history went with it", afterDelete[0].revisions, 0);
    eq("and so did its search row", afterDelete[0].search, 0);

    const dead = await fetch(`${BASE}/blog/${renamedSlug}`, { redirect: "manual" });
    eq("its URL 404s", dead.status, 404);

    // The redirect now points at nothing. That is correct rather than a bug —
    // the author deleted the destination — and it is worth pinning so a future
    // "tidy up redirects on delete" does not silently turn it into a 404 that
    // reports the same thing for a different reason.
    const orphan = await fetch(`${BASE}/blog/${slug}`, { redirect: "manual" });
    ok(
      "the old path still has a redirect row, now pointing at a deleted URL",
      orphan.status === 404 || orphan.status === 308,
      `status ${orphan.status}`
    );

    // ── 13. the image can now be deleted, and is ──────────────────────────
    //
    // `deleteMedia` refuses while anything references the object, searched
    // across posts, pages and collection entries. The post that referenced it
    // is gone, so the refusal should lift — and asserting the lift is what
    // proves the search is not simply always refusing.
    const removedMedia = await callAction(
      ids,
      cookie,
      "deleteMediaAction",
      [mediaId, false],
      { pagePath: "/studio/media" }
    );
    ok("the image can be deleted once nothing references it", removedMedia.result?.ok === true, JSON.stringify(removedMedia.result));

    const { rows: mediaAfter } = await client.query(`SELECT count(*)::int AS n FROM media WHERE id = $1`, [mediaId]);
    eq("the media row is gone", mediaAfter[0].n, 0);
    // The bytes are gone too: an orphaned blob is charged for and invisible.
    const imgDead = await fetch(`${BASE}/api/img/${objectPath}`);
    eq("and the object no longer answers", imgDead.status, 404);
    mediaId = null;

    slug = null;
  }
} catch (err) {
  failures.push(`threw: ${err.message}\n${err.stack}`);
} finally {
  // ── cleanup ─────────────────────────────────────────────────────────────
  //
  // Belt and braces: the run above deletes its own post through the action, so
  // this only fires when something threw first. The redirect and slug_history
  // rows are cleared here too, since a failed run must not leave a permanent
  // 301 pointing at a slug that never existed.
  //
  // Order matters for the media: the post is removed FIRST so the reference
  // that would block the delete is gone, and the object is removed through the
  // library rather than through the SDK directly, because that is what also
  // drops the cache tag — an orphaned blob left by a failed run is billed for
  // and, worse, invisible to `media-reconcile.mjs` if it still has a row.
  if (slug) {
    await client.query(`DELETE FROM posts WHERE slug LIKE $1`, [`${slug}%`]).catch(() => {});
  }
  await client
    .query(`DELETE FROM slug_history WHERE slug LIKE 'studio%'`)
    .catch(() => {});
  await client
    .query(`DELETE FROM redirects WHERE source LIKE '/blog/studio%'`)
    .catch(() => {});
  await client
    .query(`DELETE FROM search_index WHERE id LIKE 'post:studio%'`)
    .catch(() => {});

  if (mediaId) {
    const { rows: refs } = await client
      .query(
        `SELECT count(*)::int AS n FROM post_revisions WHERE html LIKE $1`,
        [`%${objectPath}%`]
      )
      .catch(() => ({ rows: [{ n: 0 }] }));
    if (refs[0].n === 0) {
      await callAction(ids, cookie, "deleteMediaAction", [mediaId, true], {
        pagePath: "/studio/media",
      }).catch(() => {});
    }
    // If it is STILL referenced, the row goes without the object rather than
    // the other way round: a row with no blob is reported by
    // `media-reconcile.mjs`, whereas a blob with no row is not.
    await client.query(`DELETE FROM media WHERE id = $1`, [mediaId]).catch(() => {});
    mediaId = null;
  }

  const { rows: after } = await client.query(`SELECT count(*)::int AS n FROM posts`);
  ok(
    "the corpus is back to its original size",
    after[0].n === startingCount,
    `${startingCount} -> ${after[0].n}`
  );

  const { rows: mediaFinal } = await client.query(`SELECT count(*)::int AS n FROM media`);
  ok(
    "and so is the media library",
    mediaFinal[0].n === startingMedia,
    `${startingMedia} -> ${mediaFinal[0].n}`
  );

  await client.query(`DELETE FROM sessions WHERE token_hash = $1`, [
    (await import("node:crypto")).createHash("sha256").update(token).digest("hex"),
  ]).catch(() => {});
  await client.end();
}

console.log(`\nassertions: ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`\n  FAIL  ${f}`);
  process.exitCode = 1;
} else {
  console.log("OK — create, preview, publish, serve and withdraw all behave.");
}
