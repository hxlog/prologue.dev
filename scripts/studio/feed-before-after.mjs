/**
 * Old pipeline vs new pipeline, on the same posts.
 *
 * `compare-feeds.mjs` compares against PRODUCTION, and production is running
 * whatever was deployed last — which is not necessarily this branch's parent. A
 * size difference there says "these two builds differ", not "this change did
 * that". So the change is measured against its own predecessor instead, by
 * loading the previous `content.js` from git and running both over the corpus.
 *
 * `feed-sanitize-check.mjs` answers the same question by skipping the sanitizer
 * at the end; this answers it by skipping the whole file, which also catches a
 * change in the passes before it.
 *
 * Run:
 *   node --env-file=.env.local --import ./scripts/auth/register-loader.mjs \
 *     scripts/studio/feed-before-after.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const { pool } = await import(pathToFileURL(path.join(ROOT, "src/lib/db/index.js")).href);

// The parent revision's content.js, written next to the current one so its
// relative imports resolve the same way.
const OLD = path.join(ROOT, "src/lib/feed/.content-before.mjs");
const original = execFileSync("git", ["show", "HEAD:src/lib/feed/content.js"], {
  cwd: ROOT,
  encoding: "utf8",
});
fs.writeFileSync(OLD, original.replace(/from "\.\/(\w[\w-]*)"/g, 'from "./$1.js"'));

let before;
let after;
try {
  before = await import(pathToFileURL(OLD).href);
  after = await import(pathToFileURL(path.join(ROOT, "src/lib/feed/content.js")).href);
} finally {
  fs.rmSync(OLD, { force: true });
}

const { rows } = await pool.query(
  `SELECT p.slug, p.title, p.description, r.html
     FROM posts p JOIN post_revisions r ON r.id = p.published_revision_id
    ORDER BY p.slug`
);

let grew = 0;
let shrank = 0;
let same = 0;
const worst = [];

for (const r of rows) {
  const post = {
    slug: r.slug,
    title: r.title,
    description: r.description,
    body: { html: r.html },
    image: null,
  };
  const oldHtml = before.buildFeedContent(post);
  const newHtml = after.buildFeedContent(post);
  const delta = newHtml.length - oldHtml.length;

  if (delta === 0) same++;
  else if (delta > 0) grew++;
  else shrank++;

  if (delta !== 0) worst.push({ slug: r.slug, delta, oldHtml, newHtml });
}

worst.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

console.log(`posts: ${rows.length}   same: ${same}   grew: ${grew}   shrank: ${shrank}`);

// Every changed post, when there are few enough to read. A silent "top 4" would
// make the tail of the distribution invisible, and the tail is where a change
// that is NOT the malformed-nesting fix would hide.
for (const w of worst.slice(0, 12)) {
  const at = firstDifference(w.oldHtml, w.newHtml);
  console.log(`\n${w.slug}  (${w.delta > 0 ? "+" : ""}${w.delta} bytes, first difference at ${at})`);
  console.log(`  before: ${JSON.stringify(w.oldHtml.slice(Math.max(0, at - 60), at + 160))}`);
  console.log(`  after : ${JSON.stringify(w.newHtml.slice(Math.max(0, at - 60), at + 160))}`);
}

function firstDifference(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return n;
}

await pool.end();
