/**
 * F2 guard: the ids on rendered <h2>-<h6> elements must equal the ids the TOC
 * links to. Before the fix these disagreed on 15 of 404 headings, across 9
 * posts, and clicking those entries did nothing.
 *
 * Needs .contentlayer/generated (run `npm run build:content` first). It is
 * superseded by the equivalence harness once the new pipeline exists, but stays
 * useful because it checks heading COUNT as well as ids.
 *
 * Run: node scripts/check-slug-parity.mjs
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { extractHeadings } = await import(
  pathToFileURL(path.join(ROOT, "src", "lib", "content", "slug.js")).href
);

const posts = JSON.parse(
  readFileSync(path.join(ROOT, ".contentlayer", "generated", "Post", "_index.json"), "utf8")
);

let pairs = 0;
let mismatched = 0;
let countMismatch = 0;

for (const post of posts) {
  const domIds = [...post.body.html.matchAll(/<h[2-6] id="([^"]+)"/g)].map((m) => m[1]);
  const headings = extractHeadings(post.body.raw);

  if (domIds.length !== headings.length) {
    countMismatch++;
    console.error(`COUNT ${post.slug}: dom=${domIds.length} toc=${headings.length}`);
    continue;
  }
  for (let i = 0; i < domIds.length; i++) {
    pairs++;
    if (domIds[i] !== headings[i].id) {
      mismatched++;
      if (mismatched <= 10) {
        console.error(
          `${post.slug}\n  dom=${JSON.stringify(domIds[i])}\n  toc=${JSON.stringify(headings[i].id)}`
        );
      }
    }
  }
}

console.log(
  `\n${pairs} headings checked, ${mismatched} id mismatches, ${countMismatch} count mismatches`
);
process.exit(mismatched === 0 && countMismatch === 0 ? 0 : 1);
