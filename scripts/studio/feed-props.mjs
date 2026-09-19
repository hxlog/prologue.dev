/**
 * What property KEYS does the parser actually produce, per tag?
 *
 * The attribute allowlist has to be written in the parser's own naming, and
 * `hast-util-from-html` runs parse5 in HTML mode and then maps attribute names
 * through property-information. That mapping is not the identity for anything
 * with a dash or a capital — `class` becomes `className`, `viewBox` stays
 * `viewBox`, `colspan` becomes `colSpan` — and MathML's camelCase names are not
 * in the html schema at all.
 *
 * Guessing this is how a sanitizer silently strips every code block's syntax
 * highlighting, so it is asked instead.
 *
 * Run:
 *   node --env-file=.env.local --import ./scripts/auth/register-loader.mjs \
 *     scripts/studio/feed-props.mjs
 */

import { pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = process.cwd();
const { pool } = await import(pathToFileURL(path.join(ROOT, "src/lib/db/index.js")).href);
const { buildFeedContent } = await import(
  pathToFileURL(path.join(ROOT, "src/lib/feed/content.js")).href
);
const { fromHtml } = await import(
  pathToFileURL(path.join(ROOT, "node_modules/hast-util-from-html/index.js")).href
);

const { rows } = await pool.query(
  `SELECT p.slug, p.title, p.description, r.html
     FROM posts p JOIN post_revisions r ON r.id = p.published_revision_id`
);

/** tag -> Set of property keys seen on it, and a sample value. */
const byTag = new Map();

for (const r of rows) {
  const html = buildFeedContent({
    slug: r.slug,
    title: r.title,
    description: r.description,
    body: { html: r.html },
    image: null,
  });

  const tree = fromHtml(html, { fragment: true });
  const stack = [tree];
  while (stack.length) {
    const node = stack.pop();
    if (!node || !Array.isArray(node.children)) continue;
    for (const child of node.children) {
      if (child.type !== "element") continue;
      if (!byTag.has(child.tagName)) byTag.set(child.tagName, new Map());
      const bucket = byTag.get(child.tagName);
      for (const [key, value] of Object.entries(child.properties ?? {})) {
        const shown = Array.isArray(value) ? value.join(" ") : value;
        if (!bucket.has(key)) bucket.set(key, String(shown).slice(0, 60));
      }
      stack.push(child);
    }
  }
}

for (const tag of [...byTag.keys()].sort()) {
  const bucket = byTag.get(tag);
  if (bucket.size === 0) continue;
  console.log(`\n${tag}`);
  for (const [key, sample] of bucket) {
    console.log(`  ${key.padEnd(24)} e.g. ${JSON.stringify(sample)}`);
  }
}

await pool.end();
