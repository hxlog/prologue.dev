/**
 * Content importer: data/content/blog/**\/*.md -> prologue Postgres.
 *
 * Reads the markdown from disk, renders each post through the SHARED
 * renderMarkdown(), and writes posts + post_revisions + tags + post_tags into
 * the database.
 *
 * Historically this read Contentlayer's generated index instead of the files.
 * That indirection is gone — Contentlayer is uninstalled, and the index was a
 * projection of these same files with the same parser (js-yaml, via
 * gray-matter) that this now does directly.
 *
 * Idempotent: re-running adds a revision rather than duplicating rows.
 *
 * `--reset` first clears the content tables (posts, revisions, tags, search
 * index). Use it when a change to the renderer or importer should replace the
 * imported rows outright rather than stack a second revision on top: revision
 * numbers are meant to be a real edit history, and 63 posts that each show one
 * "re-import" revision before launch is noise, not history.
 *
 * Usage (from the repo root):
 *   node --env-file=.env.local scripts/db/import-posts.mjs [--dry] [--reset]
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const CONTENT_DIR = path.join(ROOT, "data", "content", "blog");
const DRY = process.argv.includes("--dry");
const RESET = process.argv.includes("--reset");

const { renderMarkdown, deriveSlugs, RENDERER_VERSION } = await import(
  pathToFileURL(path.join(ROOT, "src/lib/markdown/render.js")).href
);
const { parseFrontmatter } = await import(
  pathToFileURL(path.join(ROOT, "src/lib/content/frontmatter.js")).href
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
 * Normalise a source file's line endings to LF.
 *
 * The content files are stored LF in the repository and checked out CRLF on
 * Windows (`core.autocrlf=true`), so the SAME post renders differently
 * depending on which machine read it. Measured against the live site, whose
 * checkout is LF: the local build had 163 carriage returns across the feeds and
 * some inside post HTML (`<p>…喜爱\r\nNonandrophilic…`), production had zero.
 *
 * Production is the correct rendering. `\r` inside a `<p>` is invisible in a
 * browser but is a literal junk character in a feed, a search snippet, or
 * anything that copies the text out.
 *
 * Normalising here — at the boundary where bytes enter the system — rather than
 * in the renderer means every downstream consumer (rendered HTML, stored
 * markdown, reading time, headings, search body text, revision diffs) sees one
 * canonical form. A revision's `content_hash` is then stable across platforms
 * too, which matters because autosave uses it to decide whether anything
 * actually changed.
 */
function normalizeEol(text) {
  return String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * Remove carriage returns from a frontmatter scalar.
 *
 * Same class of problem, one layer up: `description`, `imageDesc` and titles
 * come back from the YAML parser with a trailing `\r` when the file was read
 * with CRLF, and every consumer renders them verbatim.
 */
function stripCr(value) {
  return typeof value === "string" ? value.replace(/\r/g, "") : value;
}

/** Every .md under data/content/blog, recursively, in a stable order. */
function listPostFiles(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return listPostFiles(full);
      return entry.name.endsWith(".md") ? [full] : [];
    })
    .sort();
}

/**
 * Read one file into the shape the rest of this script expects.
 *
 * `sourceFilePath` and `flattenedPath` are relative to data/content and
 * POSIX-separated, which is what they were when Contentlayer produced them —
 * `source_path` is stored in the database and rendered into a GitHub URL, so a
 * Windows backslash there would produce a link that 404s.
 */
function readPost(file) {
  const sourceFilePath = path
    .relative(path.join(ROOT, "data", "content"), file)
    .split(path.sep)
    .join("/");

  // Normalised to LF before anything reads it — see normalizeEol.
  const markdown = normalizeEol(fs.readFileSync(file, "utf8"));
  const { data } = parseFrontmatter(markdown);

  return {
    sourceFilePath,
    flattenedPath: sourceFilePath.replace(/\.md$/, ""),
    // Everything below is read as the author typed it. `data.publishDate` may
    // be a Date if the YAML was zero-padded and the parser resolved the
    // timestamp type; parseContentDate handles both, and pinning it there
    // rather than here is what keeps this identical to what /studio will do.
    title: stripCr(data.title),
    description: stripCr(data.description),
    tags: data.tags ?? [],
    draft: data.draft === true,
    featured: data.featured === true,
    image: stripCr(data.image),
    imageDesc: stripCr(data.imageDesc),
    publishDate: data.publishDate,
    lastmod: data.lastmod,
    markdown,
  };
}

const files = listPostFiles(CONTENT_DIR);
const index = files.map(readPost);

for (const doc of index) {
  if (!doc.title) throw new Error(`${doc.sourceFilePath}: missing title`);
  if (!doc.publishDate && !doc.draft) {
    throw new Error(`${doc.sourceFilePath}: published post has no publishDate`);
  }
}

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
  //
  // `sort_order` is seeded from the order the LIVE site produces, not from an
  // alphabetical list. The sidebar orders tags by post count, and four of them
  // tie on 8 posts, so the tie-break decides what visitors actually see:
  //
  //   live:  Economics 28  Sociology 25  Finance 19  Capitalism 13
  //          Politics 12  Quant 12  Meta 8  Education 8  Philosophy 8
  //          Inequality 8  Technology 7  Crypto 6  AI 4  Gender 2
  //
  // The live order is the order in which the old module-scope loop happened to
  // first encounter each tag while walking the post array — arbitrary, but
  // visible on every archive page, so it is reproduced rather than improved.
  // Computing it here (rather than hardcoding) means it stays correct if the
  // corpus changes before this runs again.
  const tagIds = new Map();
  const counts = new Map();
  for (const doc of index) {
    if (doc.draft) continue;
    for (const t of doc.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
  }
  const allTags = [...counts.keys()].sort((a, b) => {
    const delta = counts.get(b) - counts.get(a);
    if (delta !== 0) return delta;
    // Preserve first-encounter order among ties, exactly as Object.keys over
    // the accumulating count object did.
    const firstSeen = (slug) =>
      index.findIndex((d) => !d.draft && (d.tags || []).includes(slug));
    return firstSeen(a) - firstSeen(b);
  });

  for (const [order, slug] of allTags.entries()) {
    const { rows } = await client.query(
      `INSERT INTO tags (slug, label, sort_order) VALUES ($1, $2, $3)
       ON CONFLICT (slug) DO UPDATE SET label = EXCLUDED.label,
                                        sort_order = EXCLUDED.sort_order
       RETURNING id`,
      [slug, TAG_LABELS[slug] || slug, order]
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
    const { html, headings, readingTime } = await renderMarkdown(doc.markdown);
    const slugs = deriveSlugs(doc.flattenedPath);

    const status = doc.draft ? "draft" : "published";
    // Normalise through parseContentDate. `doc.publishDate` as read from YAML
    // is either a string in whatever form the author typed (`2025-2-15`) or a
    // timestamp the YAML parser already resolved to a Date in the machine's
    // zone. Re-parsing explicitly makes the stored instant, and therefore the
    // rendered date and the feed pubDate, identical everywhere.
    const publishedAt = status === "published" ? contentDateISO(doc.publishDate) : null;
    const lastmod = contentDateISO(doc.lastmod);

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
                cover_image_desc=$6, published_at=$7, lastmod=$8,
                source_path=$9, updated_at=now()
         WHERE id=$1`,
        [
          postId,
          status,
          doc.featured,
          doc.image || null,
          doc.imageDesc || null,
          doc.imageDesc || null,
          publishedAt,
          lastmod,
          doc.sourceFilePath,
        ]
      );
      updated++;
    } else {
      const { rows } = await client.query(
        `INSERT INTO posts (slug, status, featured, cover_image, cover_alt, cover_image_desc,
                            published_at, lastmod, source_path, giscus_enabled)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true) RETURNING id`,
        [
          slugs.slugAsParams,
          status,
          doc.featured,
          doc.image || null,
          doc.imageDesc || null,
          doc.imageDesc || null,
          publishedAt,
          lastmod,
          doc.sourceFilePath,
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
        doc.markdown,
        html,
        JSON.stringify(headings ?? []),
        readingTime ? JSON.stringify(readingTime) : null,
        RENDERER_VERSION,
        contentHash(doc.markdown),
        nextRev === 1 ? "initial import from content files" : "re-import",
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
    if (doc.draft) continue;
    const slugs = deriveSlugs(doc.flattenedPath);
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
        contentDateISO(doc.publishDate),
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
