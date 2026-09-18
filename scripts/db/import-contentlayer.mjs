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
 * Usage (from the worktree root):
 *   node --env-file=.env.local scripts/db/import-contentlayer.mjs [--dry]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const DRY = process.argv.includes("--dry");

const { renderMarkdown, deriveSlugs, RENDERER_VERSION } = await import(
  pathToFileURL(path.join(ROOT, "src/lib/markdown/render.js")).href
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

const index = JSON.parse(
  fs.readFileSync(path.join(ROOT, ".contentlayer/generated/Post/_index.json"), "utf8")
);

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL_UNPOOLED,
  ssl: false,
});

console.log(`\nImporting ${index.length} posts (dry=${DRY})...\n`);
await client.connect();

try {
  await client.query("BEGIN");

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
    const publishedAt = status === "published" ? doc.publishDate : null;

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
          doc.lastmod || null,
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
          doc.lastmod || null,
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
          headings, reading_time, renderer_version, change_summary)
       VALUES ($1,$2,$3,$4,$5,$6,NULL,$7,$8,$9,$10)
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
        nextRev === 1 ? "initial import from Contentlayer" : "re-import",
      ]
    );

    const revisionId = insertedRev[0].id;
    const pointerCol = status === "published" ? "published_revision_id" : "draft_revision_id";
    await client.query(
      `UPDATE posts SET ${pointerCol} = $2 WHERE id = $1`,
      [postId, revisionId]
    );

    // tags
    await client.query(`DELETE FROM post_tags WHERE post_id = $1`, [postId]);
    for (const t of doc.tags || []) {
      const tagId = tagIds.get(t);
      if (!tagId) {
        warnings.push(`${slugs.slugAsParams}: unknown tag ${t}`);
        continue;
      }
      await client.query(
        `INSERT INTO post_tags (post_id, tag_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [postId, tagId]
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
        doc.publishDate,
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
