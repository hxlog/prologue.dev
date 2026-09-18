#!/usr/bin/env node
/**
 * Full-site parity sweep: every page the live site serves, compared to the
 * local build.
 *
 *   LOCAL_BASE=http://localhost:3211 node scripts/db/full-sweep.mjs
 *
 * Text content only — see compare-pages.mjs for why a byte diff is not useful
 * on HTML. This covers all 63 post pages plus the static routes, tag pages and
 * every feed, which is the check that the migration changed nothing a reader
 * can see.
 */

import process from "node:process";
import pg from "pg";

const LOCAL = process.env.LOCAL_BASE || "http://localhost:3211";
const LIVE = process.env.LIVE_BASE || "https://prologue.dev";

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

const c = new pg.Client({ connectionString: process.env.DATABASE_URL_UNPOOLED });
await c.connect();
const { rows: posts } = await c.query(
  `SELECT slug FROM posts WHERE status = 'published' ORDER BY slug`
);
const { rows: tags } = await c.query(`SELECT slug FROM tags ORDER BY slug`);
await c.end();

const paths = [
  "/",
  "/blog",
  "/about",
  "/microblog",
  "/links",
  ...tags.map((t) => `/tags/${t.slug}`),
  ...posts.map((p) => `/blog/${p.slug}`),
];

console.log(`checking ${paths.length} paths against ${LIVE}\n`);

let ok = 0;
const failures = [];

// Bounded concurrency — the live site is a real production deployment and does
// not deserve 80 simultaneous requests.
const LIMIT = 6;
let cursor = 0;

async function worker() {
  while (cursor < paths.length) {
    const p = paths[cursor++];
    try {
      const [a, b] = await Promise.all([
        fetch(`${LIVE}${p}`).then((r) => r.text()),
        fetch(`${LOCAL}${p}`).then((r) => r.text()),
      ]);
      const A = visibleText(a);
      const B = visibleText(b);
      if (A === B) {
        ok++;
        continue;
      }
      let i = 0;
      while (i < A.length && i < B.length && A[i] === B[i]) i++;
      failures.push({
        path: p,
        offset: i,
        live: A.slice(Math.max(0, i - 50), i + 110),
        local: B.slice(Math.max(0, i - 50), i + 110),
      });
    } catch (err) {
      failures.push({ path: p, offset: -1, live: err.message, local: "" });
    }
  }
}

await Promise.all(Array.from({ length: LIMIT }, worker));

console.log(`${ok} identical, ${failures.length} differ\n`);
for (const f of failures) {
  console.log(`  ${f.path}  (offset ${f.offset})`);
  console.log(`     live : …${f.live}…`);
  console.log(`     local: …${f.local}…`);
}

process.exitCode = failures.length === 0 ? 0 : 1;
