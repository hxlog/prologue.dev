/**
 * Compiles every post with the CURRENT pipeline (src/lib/content/pipeline.js)
 * and diffs against the committed Contentlayer2 baseline.
 *
 * A difference is a failure unless the post's slug appears in
 * scripts/render-fixes.json, which lists the deliberate fixes (F1) applied
 * during the migration. An unexplained diff is a pipeline bug -- do not add a
 * fix entry to silence one.
 *
 * Run: node scripts/check-render-equivalence.mjs
 * Exit: 0 = equivalent (or only expected differences), 1 = regression
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const baseline = JSON.parse(
  readFileSync(path.join(ROOT, "scripts", "fixtures", "render-baseline.json"), "utf8")
);
const fixesPath = path.join(ROOT, "scripts", "render-fixes.json");
const fixes = existsSync(fixesPath) ? JSON.parse(readFileSync(fixesPath, "utf8")) : {};

const { renderAll } = await import(
  pathToFileURL(path.join(ROOT, "src", "lib", "content", "pipeline.js")).href
);

const rendered = await renderAll();

let unexpected = 0;
let expected = 0;
// Slugs that differ from the baseline but are missing from render-fixes.json.
const unexplained = [];

for (const [slug, reference] of Object.entries(baseline)) {
  const actual = rendered[slug];
  if (actual === undefined) {
    console.error(`MISSING  ${slug}  (not produced by the pipeline)`);
    unexpected++;
    continue;
  }
  if (actual === reference) continue;

  const slugFixes = fixes[slug];
  const allApplied =
    Array.isArray(slugFixes) &&
    slugFixes.length > 0 &&
    slugFixes.every((f) => (f.applied ? actual.includes(f.marker) : false));
  if (allApplied) {
    expected++;
    continue;
  }

  unexplained.push(slug);
  let i = 0;
  while (i < actual.length && i < reference.length && actual[i] === reference[i]) i++;
  console.error(`DIFF     ${slug}  at char ${i}`);
  console.error(`  baseline: ${JSON.stringify(reference.slice(Math.max(0, i - 60), i + 80))}`);
  console.error(`  actual  : ${JSON.stringify(actual.slice(Math.max(0, i - 60), i + 80))}`);
  unexpected++;
}

  // Fix entries for posts that now match the baseline are stale. A stale entry
  // is not a harmless leftover: it masks a real difference, because the harness
  // would have reported "expected" for a post whose pipeline output silently
  // regressed back to the baseline. Report them as failures.
const stale = Object.keys(fixes).filter((slug) => rendered[slug] === baseline[slug]);
if (stale.length) {
  console.error(`STALE    ${stale.length} render-fixes entry(ies) describe no difference:`);
  for (const slug of stale) console.error(`  ${slug}`);
  unexpected += stale.length;
}

console.log(
  `\n${Object.keys(baseline).length} posts: ${expected} expected-diff, ${unexpected} unexpected`
);
process.exit(unexpected === 0 ? 0 : 1);
