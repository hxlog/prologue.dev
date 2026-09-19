/**
 * What does the feed's item HTML actually contain, across all 63 posts?
 *
 * This decides what the sanitizer's allowlist has to be. A feed sanitizer
 * written from a guess about which tags appear is either too narrow — silently
 * deleting MathML from the posts that use it — or too wide and therefore
 * pointless. So the corpus is asked directly, through `buildFeedContent`, which
 * is the function the feeds themselves call.
 *
 * Run:
 *   node --env-file=.env.local --import ./scripts/auth/register-loader.mjs \
 *     scripts/studio/feed-survey.mjs
 */

import { pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = process.cwd();
const { pool } = await import(pathToFileURL(path.join(ROOT, "src/lib/db/index.js")).href);
const { buildFeedContent } = await import(
  pathToFileURL(path.join(ROOT, "src/lib/feed/content.js")).href
);

const { rows } = await pool.query(
  `SELECT p.slug, p.title, p.description, r.html
     FROM posts p JOIN post_revisions r ON r.id = p.published_revision_id`
);

const tags = new Map();
const attrs = new Map();
let total = 0;
const withMath = [];

for (const r of rows) {
  const html = buildFeedContent({
    slug: r.slug,
    title: r.title,
    description: r.description,
    body: { html: r.html },
    image: null,
  });
  total += html.length;

  for (const m of html.matchAll(/<([a-zA-Z][\w:-]*)\b([^>]*)>/g)) {
    const tag = m[1].toLowerCase();
    tags.set(tag, (tags.get(tag) || 0) + 1);
    for (const a of m[2].matchAll(/([a-zA-Z][\w:-]*)\s*=/g)) {
      const attr = a[1].toLowerCase();
      attrs.set(attr, (attrs.get(attr) || 0) + 1);
    }
  }

  if (/<svg|<math|<mi\b/.test(html)) withMath.push(r.slug);
}

const sorted = (m) =>
  [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(" ");

console.log(`posts: ${rows.length}   total bytes: ${total}`);
console.log(`\nTAGS:\n${sorted(tags)}`);
console.log(`\nATTRS:\n${sorted(attrs)}`);
console.log(`\nposts still carrying math or svg: ${withMath.length}`);
console.log(withMath.slice(0, 10).join(", "));

await pool.end();
