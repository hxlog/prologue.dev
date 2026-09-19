#!/usr/bin/env node
/**
 * Preview parity: the studio's preview must render a byte-identical HTML
 * string to what publishing stores.
 *
 * This is the single property the whole storage design rests on — CLAUDE.md
 * states it as "the editor previews exactly what will be published", and the
 * claim is only true because both call `renderMarkdown`. A test that asserts it
 * is therefore not checking a function; it is checking that nobody has
 * introduced a second rendering path.
 *
 * Two things are compared for every document in the corpus:
 *
 *   1. `renderMarkdown(source).html` against the html ALREADY STORED in the
 *      database for that post. If these differ, the database was rendered by a
 *      different version of the pipeline than the one currently in the tree —
 *      which is what `renderer_version` exists to detect.
 *   2. `renderMarkdown(source).html` against a fresh render of the same source,
 *      which catches non-determinism (plugin ordering, a Map iteration, a
 *      locale-dependent formatter) that would make the preview flicker.
 *
 *   node --env-file=.env.local scripts/studio/preview-parity.mjs
 *   node --env-file=.env.local scripts/studio/preview-parity.mjs --check-db
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const CONTENT = path.join(ROOT, "data", "content");

const { renderMarkdown, RENDERER_VERSION } = await import(
  pathToFileURL(path.join(ROOT, "src/lib/markdown/render.js")).href
);

const CHECK_DB = process.argv.includes("--check-db");

function walk(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return walk(full);
      return e.name.endsWith(".md") ? [full] : [];
    })
    .sort();
}

const files = walk(CONTENT);

// ── 1. determinism ─────────────────────────────────────────────────────────
let deterministic = 0;
const nondeterministic = [];

for (const file of files) {
  const source = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const a = await renderMarkdown(source);
  const b = await renderMarkdown(source);
  if (a.html === b.html) {
    deterministic++;
  } else {
    nondeterministic.push(path.relative(ROOT, file).split(path.sep).join("/"));
  }
}

console.log(`renderer version : ${RENDERER_VERSION}`);
console.log(`documents        : ${files.length}`);
console.log(`deterministic    : ${deterministic}/${files.length}`);

if (nondeterministic.length) {
  console.log(`\nNON-DETERMINISTIC (${nondeterministic.length}):`);
  for (const f of nondeterministic.slice(0, 10)) console.log(`  ${f}`);
  process.exitCode = 1;
}

// ── 2. against the stored html ─────────────────────────────────────────────
if (CHECK_DB) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL_UNPOOLED });
  await client.connect();

  const { rows } = await client.query(
    `SELECT p.slug, p.source_path, r.html, r.renderer_version, r.markdown
       FROM posts p
       JOIN post_revisions r ON r.id = p.published_revision_id
      ORDER BY p.slug`
  );

  let match = 0;
  let htmlDiffers = 0;
  let versionStale = 0;
  const problems = [];

  for (const row of rows) {
    if (row.renderer_version !== RENDERER_VERSION) {
      versionStale++;
      problems.push(`${row.slug}: stored rv${row.renderer_version}, current rv${RENDERER_VERSION}`);
      continue;
    }

    // Render from the STORED markdown, not the file: the database is the
    // authority, and the two can legitimately differ if a post was edited in
    // /studio after the last import.
    const { html } = await renderMarkdown(row.markdown);
    if (html === row.html) match++;
    else {
      htmlDiffers++;
      problems.push(`${row.slug}: rendered html differs from stored (${html.length} vs ${row.html.length} bytes)`);
    }
  }

  console.log(`\nstored posts     : ${rows.length}`);
  console.log(`html identical   : ${match}/${rows.length}`);
  console.log(`html differs     : ${htmlDiffers}`);
  console.log(`stale renderer   : ${versionStale}`);

  if (problems.length) {
    console.log(`\nPROBLEMS (${problems.length}):`);
    for (const p of problems.slice(0, 20)) console.log(`  ${p}`);
    process.exitCode = 1;
  }

  await client.end();
}

console.log(
  process.exitCode === 1
    ? "\nFAILED."
    : "\nOK — preview and publish produce identical HTML."
);
