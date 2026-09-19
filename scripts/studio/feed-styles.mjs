/**
 * Which CSS declarations does the feed HTML actually carry?
 *
 * The sanitizer has to allow `style` because KaTeX positions every glyph with
 * one, and it has to restrict `style` because a free-form CSS string in a feed is
 * not something to hand to an unknown reader. That is only a decidable question
 * against the real corpus.
 *
 * Run:
 *   node --env-file=.env.local --import ./scripts/auth/register-loader.mjs \
 *     scripts/studio/feed-styles.mjs
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

const props = new Map();
const values = new Map();

for (const r of rows) {
  const html = buildFeedContent({
    slug: r.slug,
    title: r.title,
    description: r.description,
    body: { html: r.html },
    image: null,
  });

  for (const m of html.matchAll(/style="([^"]*)"/g)) {
    for (const decl of m[1].split(";")) {
      const [rawProp, ...rest] = decl.split(":");
      const prop = (rawProp || "").trim().toLowerCase();
      if (!prop) continue;
      props.set(prop, (props.get(prop) || 0) + 1);

      const value = rest.join(":").trim();
      // The SHAPE of the value, not the value: `1.2em` and `0.4em` are one
      // shape, and the count per shape is what says whether a value can be
      // matched by a pattern.
      const shape = value
        .replace(/-?\d+(\.\d+)?/g, "N")
        .replace(/[a-z]+/gi, "a");
      values.set(`${prop}: ${shape}`, (values.get(`${prop}: ${shape}`) || 0) + 1);
    }
  }
}

const sorted = (m) =>
  [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} (${v})`).join("\n  ");

console.log(`DECLARATIONS:\n  ${sorted(props)}`);
console.log(`\nVALUE SHAPES:\n  ${sorted(values)}`);

await pool.end();
