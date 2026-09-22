/**
 * F2 guard: the ids on the rendered <h2>-<h6> elements must equal the ids the
 * TOC links to. Before the fix these disagreed on 15 of 404 headings, across 9
 * posts, and clicking those entries did nothing.
 *
 * Both sides come from the live code, which is what makes this distinct from
 * the render harness: that one asks "is this byte-identical to Contentlayer2's
 * output?", while this one asks "do the pipeline's heading ids and the TOC's
 * heading ids agree with each other?". They are different questions, and the
 * latter is the one a reader experiences.
 *
 * It also checks heading COUNT, which the render harness cannot: the old
 * extractor used a `\n#{2,6}\s+` regex that skipped a heading appearing
 * directly after the frontmatter, so a post could render a heading the TOC
 * never listed.
 *
 * Run: node scripts/check-slug-parity.mjs
 * Exit: 0 = ids and counts agree, 1 = a TOC entry would not navigate
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { extractHeadings } = await import(
  pathToFileURL(path.join(ROOT, "src", "lib", "content", "slug.js")).href
);
const { allPosts } = await import(
  pathToFileURL(path.join(ROOT, "src", "lib", "content", "standalone.js")).href
);
const { renderAll } = await import(
  pathToFileURL(path.join(ROOT, "src", "lib", "content", "pipeline.js")).href
);

const rendered = await renderAll();

let pairs = 0;
let mismatched = 0;
let countMismatch = 0;

for (const post of allPosts) {
  const html = rendered[post.slug];
  if (html === undefined) {
    console.error(`MISSING ${post.slug}: pipeline produced no HTML`);
    countMismatch++;
    continue;
  }
  const domIds = [...html.matchAll(/<h[2-6] id="([^"]+)"/g)].map((m) => m[1]);
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
