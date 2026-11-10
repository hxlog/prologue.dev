import { Feed } from "feed";
import { compareDesc } from "date-fns";
import siteMetadata from "../../../data/sitemetadata";
import { tagLabel } from "../../../data/tagLabels";
import { IMAGE_SIZES } from "../../../data/image-sizes.js";
import { getCachedPost, getCachedPosts } from "../content/cached";
import { buildFeedContent } from "./content";
import { absolutize, postUrl, siteUrl } from "./urls";

const AUTHOR = {
  name: siteMetadata.author,
  email: siteMetadata.feedEmail,
  link: `${siteUrl()}/about`,
};

// MIME type by extension for the cover-image enclosure. .avif is included
// because the image tree was recompressed to .avif under /static/opt/ and three
// post covers now point at one; without it those posts silently lose their
// enclosure. .svg is deliberately absent: the template ships an .svg cover and
// the feed library would emit an enclosure readers cannot render.
const IMAGE_MIME = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
};

/**
 * Build a spec-valid RSS/Atom enclosure for a post's local cover image, with a
 * real byte `length` (W3C requires a positive integer; Folo uses an
 * `image/*` enclosure to populate the entry thumbnail). Returns undefined for
 * posts without a real local cover (e.g. dynamic OG cards), which then carry no
 * enclosure rather than an invalid zero-length one.
 *
 * The byte length comes from data/image-sizes.js instead of statSync(): the
 * feed is a Vercel function, and any `fs`/path call with a runtime-computed
 * `public/` path is invisible to @vercel/nft, which then traces the whole
 * public/ tree into the function. The generated manifest (same source of truth
 * as the intrinsic image sizes on article pages) is a plain lookup, so the feed
 * function no longer carries public/. Anything absent from the manifest --
 * remote URLs, .svg covers that IMAGE_MIME deliberately does not map, a file
 * removed after the manifest was generated -- yields no enclosure.
 */
function coverEnclosure(post) {
  const image = String(post.image || "").trim();
  if (!image.startsWith("/")) return undefined;

  const ext = image.split(".").pop().toLowerCase();
  const type = IMAGE_MIME[ext];
  if (!type) return undefined;

  const entry = IMAGE_SIZES[image];
  if (!entry || !entry.bytes) return undefined;

  return { url: absolutize(image), type, length: entry.bytes };
}

/** Latest (lastmod || publishDate) across the items, as an ISO string. */
function latestItemDate(items) {
  let latest = 0;
  for (const item of items) {
    const time = Date.parse(item.date);
    if (Number.isFinite(time) && time > latest) latest = time;
  }
  // An empty corpus (a brand-new template with every sample post deleted) still
  // has to produce a *deterministic* timestamp: the `feed` library otherwise
  // falls back to `new Date()` internally, which Cache Components rejects at
  // prerender time with blocking-prerender-current-time and fails the build.
  // 1970 is the honest sentinel here -- "this feed has never had content".
  return latest ? new Date(latest).toISOString() : new Date(0).toISOString();
}

/**
 * Every published post as a plain, serialisable feed item.
 *
 * This is the expensive half of the feed (it renders each body through Shiki),
 * so it is what getFeedItems() wraps in `'use cache'` -- see ./cached.js.
 *
 * It deliberately does NOT call getAllPostsWithBody(): that would render the
 * corpus into a second copy of HTML. Each body instead comes from
 * getCachedPost(slug), the same `'use cache'` + `cacheLife("max")` entry the
 * article route uses, so the feed and the page share one cached rendering.
 * Metadata comes from getCachedPosts() for the same reason: sorting needs every
 * publishDate up front, and that projection carries no HTML.
 *
 * Every field crossing the cache boundary must be serialisable, so dates are
 * ISO strings and the enclosure/category values are plain objects. assembleFeed()
 * turns them back into the Date instances the `feed` library expects.
 */
export async function buildFeedItems() {
  const posts = (await getCachedPosts())
    .filter((post) => post.draft === false)
    .sort((a, b) => compareDesc(new Date(a.publishDate), new Date(b.publishDate)));

  const items = [];

  for (const meta of posts) {
    const post = await getCachedPost(meta.slugAsParams);
    if (!post) continue;

    const url = postUrl(post.slug);
    const published = new Date(post.publishDate);
    const updated = post.lastmod ? new Date(post.lastmod) : published;

    items.push({
      title: post.title,
      id: url,
      link: url,
      description: post.description,
      content: buildFeedContent({ ...post, body: { html: post.html } }),
      date: updated.toISOString(),
      published: published.toISOString(),
      enclosure: coverEnclosure(post),
      // Atom requires term; RSS uses name as the visible category text; the
      // scheme keeps the canonical English tag URL discoverable. JSON tags get
      // the same Chinese label as the site UI.
      category: (post.tags || []).map((tag) => ({
        term: tag,
        name: tagLabel(tag),
        scheme: `${siteUrl()}/tags/${encodeURIComponent(tag)}`,
      })),
    });
  }

  return { items, updated: latestItemDate(items) };
}

/**
 * Assemble a single `Feed` instance from cached items. Shared by the RSS, Atom
 * and JSON Feed routes, which only choose the serializer (`rss2`/`atom1`/
 * `json1`) -- that keeps the three formats perfectly consistent.
 *
 * `updated` is the content-derived timestamp from buildFeedItems(): the newest
 * `lastmod || publishDate` in the corpus. It used to be `new Date()` at
 * serialisation time, which made every revalidation of an unchanged feed emit a
 * different `<lastBuildDate>` -- i.e. a new ISR write (and a new CDN object) for
 * a document that had not changed. The feed's own "last updated" timestamp is a
 * content property, so it now moves only when an article does. RSS 2.0 allows
 * `lastBuildDate` to be omitted, which is what happens for an empty corpus.
 */
export function assembleFeed(items, updated) {
  const site = siteUrl();
  const feed = new Feed({
    title: siteMetadata.title,
    description: siteMetadata.description,
    id: `${site}/`,
    link: `${site}/`,
    language: siteMetadata.language,
    favicon: `${site}${siteMetadata.favicon}`,
    image: `${site}${siteMetadata.avatar}`,
    copyright: siteMetadata.copyright,
    updated: updated ? new Date(updated) : undefined,
    generator: siteMetadata.feedGenerator,
    ttl: 60,
    feedLinks: {
      rss: `${site}/rss`,
      atom: `${site}/atomfeed`,
      json: `${site}/jsonfeed`,
    },
    author: AUTHOR,
  });

  for (const item of items) {
    feed.addItem({
      title: item.title,
      id: item.id,
      link: item.link,
      description: item.description,
      content: item.content,
      author: [AUTHOR],
      date: new Date(item.date),
      published: new Date(item.published),
      enclosure: item.enclosure,
      category: item.category,
    });
  }

  return feed;
}

/**
 * Thin compatibility wrapper for the plain-node benchmark scripts
 * (`.tmp/lead/bench3.mjs`) that still call `createFeed()`. The routes go
 * through getFeedXml() in ./cached.js, where the expensive half is cached.
 *
 * `feedUpdated` is honoured only so a benchmark can force a timestamp; the
 * production path never passes one.
 */
export async function createFeed(feedUpdated) {
  const { items, updated } = await buildFeedItems();
  const stamp = feedUpdated instanceof Date ? feedUpdated.toISOString() : updated;
  return assembleFeed(items, stamp);
}
