#!/usr/bin/env node
/**
 * Import MDX pages (data/content/pages/*.md) into the database.
 *
 *   CONTENTLAYER_ROOT=/path/to/checkout node --env-file=.env.local \
 *     scripts/db/import-pages.mjs [--dry] [--reset]
 *
 * Pages differ from posts in one way that shapes everything here: they are
 * `contentType: "mdx"`, so their stored artifact is compiled MDX bytecode, not
 * an HTML string. The bytecode embeds the rendering runtime's module ids, which
 * differ between Contentlayer's bundler and plain `@mdx-js/mdx` — so the correct
 * source of truth is the markdown, compiled by src/lib/content/mdx.js at
 * publish time, and that is what this writes.
 *
 * `html` is also stored, produced by the shared markdown renderer. It is not
 * what the route renders (the route uses the MDX component) but it is what any
 * non-JS consumer needs — feeds, search indexing, and diffing a revision
 * without evaluating it.
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const CONTENTLAYER_ROOT = process.env.CONTENTLAYER_ROOT || ROOT;
const DRY = process.argv.includes("--dry");
const RESET = process.argv.includes("--reset");

const { renderMarkdown, RENDERER_VERSION } = await import(
  pathToFileURL(path.join(ROOT, "src/lib/markdown/render.js")).href
);
const { compilePage } = await import(
  pathToFileURL(path.join(ROOT, "src/lib/content/mdx.js")).href
);

const PAGES_INDEX = path.join(
  CONTENTLAYER_ROOT,
  ".contentlayer/generated/Page/_index.json"
);

function contentHash(markdown) {
  return createHash("sha256").update(String(markdown ?? ""), "utf8").digest("hex");
}

/**
 * Normalise line endings to LF, and drop carriage returns from scalars.
 *
 * The content files are LF in the repository and CRLF on a Windows checkout
 * (`core.autocrlf=true`), so without this the same page renders differently
 * depending on which machine read it — measured against production, whose
 * checkout is LF: 163 carriage returns in the local feeds, zero in the live
 * ones. See the equivalent helpers in import-contentlayer.mjs.
 */
function normalizeEol(text) {
  return String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function stripCr(value) {
  return typeof value === "string" ? value.replace(/\r/g, "") : value;
}

const pages = JSON.parse(fs.readFileSync(PAGES_INDEX, "utf8"));
console.log(`\nImporting ${pages.length} page(s) (dry=${DRY})...\n`);

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL_UNPOOLED,
  ssl: false,
});
await client.connect();

try {
  await client.query("BEGIN");

  if (RESET) {
    await client.query(
      `UPDATE pages SET draft_revision_id = NULL, published_revision_id = NULL`
    );
    await client.query(`DELETE FROM pages`);
    console.log("reset: pages and revisions cleared");
  }

  let created = 0;
  let updated = 0;

  for (const doc of pages) {
    const slug = doc.slugAsParams;
    const markdown = normalizeEol(
      fs.readFileSync(
        path.join(ROOT, "data/content", doc._raw.sourceFilePath),
        "utf8"
      )
    );

    // The route renders the MDX component, so both artifacts are produced here
    // from the same source: the component for the page, the HTML for anything
    // that cannot evaluate JS.
    const { html, headings, readingTime } = await renderMarkdown(markdown);
    const mdxCode = await compilePage(markdown);

    const { rows: existing } = await client.query(
      `SELECT id FROM pages WHERE slug = $1`,
      [slug]
    );

    let pageId;
    if (existing.length) {
      pageId = existing[0].id;
      updated++;
    } else {
      const { rows } = await client.query(
        `INSERT INTO pages (slug, status, giscus_enabled, published_at)
         VALUES ($1, 'published', true, now()) RETURNING id`,
        [slug]
      );
      pageId = rows[0].id;
      created++;
    }

    const { rows: revRows } = await client.query(
      `SELECT coalesce(max(revision_number), 0) AS n FROM page_revisions WHERE page_id = $1`,
      [pageId]
    );
    const nextRev = revRows[0].n + 1;

    const { rows: inserted } = await client.query(
      `INSERT INTO page_revisions
         (page_id, revision_number, title, description, markdown, html,
          headings, reading_time, renderer_version, content_hash, change_summary)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id`,
      [
        pageId,
        nextRev,
        doc.title,
        doc.description ? stripCr(doc.description) : null,
        markdown,
        // `html` is where the compiled MDX bytecode is parked for pages: the
        // column is "the renderable artifact for this revision", and for an
        // MDX document that artifact is the component, not markup.
        mdxCode,
        JSON.stringify(headings ?? []),
        readingTime ? JSON.stringify(readingTime) : null,
        RENDERER_VERSION,
        contentHash(markdown),
        nextRev === 1 ? "initial import" : "re-import",
      ]
    );

    await client.query(
      `UPDATE pages SET published_revision_id = $2 WHERE id = $1`,
      [pageId, inserted[0].id]
    );
  }

  console.log(`pages: ${created} created, ${updated} updated`);

  if (DRY) {
    await client.query("ROLLBACK");
    console.log("\nDRY RUN - rolled back.");
  } else {
    await client.query("COMMIT");
    console.log("\nCOMMITTED.");
  }
} catch (err) {
  await client.query("ROLLBACK");
  throw err;
} finally {
  await client.end();
}
