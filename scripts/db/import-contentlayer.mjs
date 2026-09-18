/**
 * Content importer: Contentlayer-generated posts -> prologue Postgres.
 *
 * Reads the Contentlayer output (already verified byte-identical to the new
 * renderer), renders each post through the SHARED renderMarkdown(), and writes
 * posts + post_revisions + tags + post_tags into the database.
 *
 * Idempotent: re-running replaces the post's revision 1 and re-links tags
 * rather than duplicating rows.
 *
 * `--reset` first clears the content tables (posts, revisions, tags, search
 * index). Use it when a change to the renderer or importer should replace the
 * imported rows outright rather than stack a second revision on top: revision
 * numbers are meant to be a real edit history, and 63 posts that each show one
 * "re-import" revision before launch is noise, not history.
 *
 * Usage (from the worktree root):
 *   node --env-file=.env.local scripts/db/import-contentlayer.mjs [--dry] [--reset]
 *
 * CONTENTLAYER_ROOT overrides where `.contentlayer/` is read from. A fresh git
 * worktree has no generated output of its own, while the main checkout does, so
 * the importer reads content from here and generated metadata from there.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
// Markdown is read from this checkout; `.contentlayer/` may only exist in
// another one (a worktree does not inherit generated output).
const CONTENTLAYER_ROOT = process.env.CONTENTLAYER_ROOT || ROOT;
const DRY = process.argv.includes("--dry");
const RESET = process.argv.includes("--reset");

const { renderMarkdown, deriveSlugs, RENDERER_VERSION } = await import(
  pathToFileURL(path.join(ROOT, "src/lib/markdown/render.js")).href
);
const { contentDateISO } = await import(
  pathToFileURL(path.join(ROOT, "src/lib/content/dates.js")).href
);

// tag slug -> Chinese label, the current data/tagLabels.js contract
const TAG_LABELS = {
  Economics: "经济学",
  Finance: "金融",
  Quant: "数据科学",
  Crypto: "加密货币",
  AI: "人工智能",
  Sociology: "社会学",
  Capitalism: "资本主义",
  Education: "教育",
  Inequality: "不平等",
  Politics: "政治",
  Philosophy: "哲学",
  Technology: "技术",
  Meta: "随笔",
  Translations: "翻译",
  Gender: "性别",
};

// next.config.js redirects /tags/Web3 -> /tags/Crypto; keep it as a DB alias
const TAG_ALIASES = { Web3: "Crypto" };

/**
 * SHA-256 of the markdown source, matching how 0002 computed the backfill
 * (`encode(sha256(convert_to(markdown,'UTF8')),'hex')`). Autosave uses this to
 * skip a no-op write, so it must be byte-exact.
 */
function contentHash(markdown) {
  return createHash("sha256").update(String(markdown ?? ""), "utf8").digest("hex");
}

/**
 * Read a date field straight out of the frontmatter block, as the literal
 * string the author typed.
 *
 * Contentlayer's parsed value is already a Date, and its instant depends on
 * the time zone of whichever machine ran the build — which is why production
 * and this checkout disagreed about six posts. The raw text has no such
 * ambiguity.
 *
 * The search is confined to the frontmatter block. Scanning the whole file
 * would also match prose: one post is a tutorial about building this blog and
 * contains `lastmod:` in a code sample, which the first version of this
 * function happily picked up and wrote into the database.
 */
function rawDate(doc, field) {
  const src = fs.readFileSync(
    path.join(ROOT, "data/content", doc._raw.sourceFilePath),
    "utf8"
  );
  const block = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---/.exec(src);
  const match = block
    ? new RegExp(`^${field}:\\s*(.+?)\\s*$`, "m").exec(block[1])
    : null;
  return match ? match[1] : doc[field];
}

const index = JSON.parse(
  fs.readFileSync(
    path.join(CONTENTLAYER_ROOT, ".contentlayer/generated/Post/_index.json"),
    "utf8"
  )
);

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL_UNPOOLED,
  ssl: false,
});

console.log(`\nImporting ${index.length} posts (dry=${DRY})...\n`);
await client.connect();

try {
  await client.query("BEGIN");

  if (RESET) {
    // posts cascades to post_revisions and post_tags. tags/search_index are
    // cleared explicitly. Nulling the pointers first avoids the FK cycle
    // between posts and post_revisions being evaluated mid-delete.
    await client.query(
      `UPDATE posts SET draft_revision_id = NULL, published_revision_id = NULL`
    );
    await client.query(`DELETE FROM posts`);
    await client.query(`DELETE FROM tags`);
    await client.query(`DELETE FROM search_index`);
    console.log("reset: posts, revisions, tags, search index cleared");
  }

  // ---------------------------------------------------------------- tags
  const tagIds = new Map();
  const allTags = [...new Set(index.flatMap((d) => d.tags || []))].sort();
  for (const slug of allTags) {
    const { rows } = await client.query(
      `INSERT INTO tags (slug, label) VALUES ($1, $2)
       ON CONFLICT (slug) DO UPDATE SET label = EXCLUDED.label
       RETURNING id`,
      [slug, TAG_LABELS[slug] || slug]
    );
    tagIds.set(slug, rows[0].id);
  }
  for (const [alias, canonical] of Object.entries(TAG_ALIASES)) {
    const tagId = tagIds.get(canonical);
    if (!tagId) continue;
    await client.query(
      `INSERT INTO tag_aliases (alias_slug, tag_id) VALUES ($1, $2)
       ON CONFLICT (alias_slug) DO UPDATE SET tag_id = EXCLUDED.tag_id`,
      [alias, tagId]
    );
  }
  console.log(`tags: ${allTags.length} + ${Object.keys(TAG_ALIASES).length} alias(es)`);

  // --------------------------------------------------------------- posts
  let created = 0;
  let updated = 0;
  const warnings = [];

  for (const doc of index) {
    const srcPath = path.join(ROOT, "data/content", doc._raw.sourceFilePath);
    const markdown = fs.readFileSync(srcPath, "utf8");
    const { html, headings, readingTime } = await renderMarkdown(markdown);
    const slugs = deriveSlugs(doc._raw.flattenedPath);

    const status = doc.draft === true ? "draft" : "published";
    // Normalise through parseContentDate. `doc.publishDate` here is the
    // Contentlayer build's Date, which was itself produced by
    // `new Date("2025-2-15")` in the BUILD machine's zone — the live site
    // renders 2月15日 while this checkout renders 2月14日 for the same post.
    // Re-reading the raw frontmatter and parsing it explicitly makes the
    // stored instant, and therefore the rendered date and the feed pubDate,
    // identical everywhere.
    const publishedAt = status === "published" ? contentDateISO(rawDate(doc, "publishDate")) : null;
    const lastmod = contentDateISO(rawDate(doc, "lastmod"));

    // The route matches on slugAsParams; posts.slug stores the same value so
    // the URL can never drift from what the router resolves.
    const { rows: existing } = await client.query(
      `SELECT id FROM posts WHERE slug = $1`,
      [slugs.slugAsParams]
    );

    let postId;
    if (existing.length) {
      postId = existing[0].id;
      await client.query(
        `UPDATE posts SET status=$2, featured=$3, cover_image=$4, cover_alt=$5,
                cover_image_desc=$6, published_at=$7, lastmod=$8, updated_at=now()
         WHERE id=$1`,
        [
          postId,
          status,
          Boolean(doc.featured),
          doc.image || null,
          doc.imageDesc || null,
          doc.imageDesc || null,
          publishedAt,
          lastmod,
        ]
      );
      updated++;
    } else {
      const { rows } = await client.query(
        `INSERT INTO posts (slug, status, featured, cover_image, cover_alt, cover_image_desc,
                            published_at, lastmod, giscus_enabled)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true) RETURNING id`,
        [
          slugs.slugAsParams,
          status,
          Boolean(doc.featured),
          doc.image || null,
          doc.imageDesc || null,
          doc.imageDesc || null,
          publishedAt,
          lastmod,
        ]
      );
      postId = rows[0].id;
      created++;
    }

    // revision 1 (or bump on re-run)
    const { rows: revRows } = await client.query(
      `SELECT coalesce(max(revision_number), 0) AS n FROM post_revisions WHERE post_id = $1`,
      [postId]
    );
    const nextRev = revRows[0].n + 1;

    const { rows: insertedRev } = await client.query(
      `INSERT INTO post_revisions
         (post_id, revision_number, title, description, markdown, html, feed_html,
          headings, reading_time, renderer_version, content_hash, change_summary)
       VALUES ($1,$2,$3,$4,$5,$6,NULL,$7,$8,$9,$10,$11)
       RETURNING id`,
      [
        postId,
        nextRev,
        doc.title,
        doc.description || null,
        markdown,
        html,
        JSON.stringify(headings ?? []),
        readingTime ? JSON.stringify(readingTime) : null,
        RENDERER_VERSION,
        contentHash(markdown),
        nextRev === 1 ? "initial import from Contentlayer" : "re-import",
      ]
    );

    const revisionId = insertedRev[0].id;
    const pointerCol = status === "published" ? "published_revision_id" : "draft_revision_id";
    await client.query(
      `UPDATE posts SET ${pointerCol} = $2 WHERE id = $1`,
      [postId, revisionId]
    );

    // tags — `position` preserves the frontmatter array order, because the
    // chip row renders only the first 2-3 and hides the rest behind "+N".
    await client.query(`DELETE FROM post_tags WHERE post_id = $1`, [postId]);
    for (const [position, t] of (doc.tags || []).entries()) {
      const tagId = tagIds.get(t);
      if (!tagId) {
        warnings.push(`${slugs.slugAsParams}: unknown tag ${t}`);
        continue;
      }
      await client.query(
        `INSERT INTO post_tags (post_id, tag_id, position) VALUES ($1,$2,$3)
         ON CONFLICT (post_id, tag_id) DO UPDATE SET position = EXCLUDED.position`,
        [postId, tagId, position]
      );
    }
  }

  console.log(`posts: ${created} created, ${updated} updated`);

  // ------------------------------------------------------- search_index
  await client.query(`DELETE FROM search_index WHERE kind = 'post'`);
  for (const doc of index) {
    if (doc.draft === true) continue;
    const slugs = deriveSlugs(doc._raw.flattenedPath);
    const { rows } = await client.query(
      `SELECT p.id, r.html, r.title, r.description
       FROM posts p JOIN post_revisions r ON r.id = p.published_revision_id
       WHERE p.slug = $1`,
      [slugs.slugAsParams]
    );
    if (!rows.length) continue;
    const r = rows[0];
    const labelTags = (doc.tags || []).map((t) => TAG_LABELS[t] || t);
    const bodyText = stripHtml(r.html);
    await client.query(
      `INSERT INTO search_index (id, kind, ref_id, title, description, url, tags, body_text, published_at)
       VALUES ($1,'post',$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET
         title=EXCLUDED.title, description=EXCLUDED.description, url=EXCLUDED.url,
         tags=EXCLUDED.tags, body_text=EXCLUDED.body_text, published_at=EXCLUDED.published_at,
         updated_at=now()`,
      [
        `post:${slugs.slugAsParams}`,
        r.id,
        r.title,
        r.description,
        `/blog/${slugs.slugAsParams}`,
        [...(doc.tags || []), ...labelTags],
        bodyText,
        contentDateISO(rawDate(doc, "publishDate")),
      ]
    );
  }

  // ----------------------------------------------------------- nav items
  const { rows: navCount } = await client.query(`SELECT count(*)::int AS n FROM nav_items`);
  if (navCount[0].n === 0) {
    const nav = [
      ["Blog", "/blog", 0],
      ["Microblog", "/microblog", 1],
      ["Tags", "/tags", 2],
      ["Links", "/links", 3],
      ["About", "/about", 4],
    ];
    for (const [label, href, order] of nav) {
      await client.query(
        `INSERT INTO nav_items (label, href, sort_order) VALUES ($1,$2,$3)`,
        [label, href, order]
      );
    }
    console.log(`nav_items: seeded ${nav.length}`);
  }

  if (DRY) {
    await client.query("ROLLBACK");
    console.log("\nDRY RUN - rolled back.");
  } else {
    await client.query("COMMIT");
    console.log("\nCOMMITTED.");
  }

  if (warnings.length) {
    console.log(`\nwarnings (${warnings.length}):`);
    for (const w of warnings.slice(0, 20)) console.log("  " + w);
  }

  // ------------------------------------------------------------ summary
  const { rows: summary } = await client.query(
    `SELECT
       (SELECT count(*) FROM posts)                    AS posts,
       (SELECT count(*) FROM posts WHERE status='published') AS published,
       (SELECT count(*) FROM post_revisions)           AS revisions,
       (SELECT count(*) FROM tags)                     AS tags,
       (SELECT count(*) FROM search_index)             AS search_rows`
  );
  console.log("\n" + JSON.stringify(summary[0], null, 2));
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("\nIMPORT FAILED:\n", err);
  process.exitCode = 1;
} finally {
  await client.end();
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}
