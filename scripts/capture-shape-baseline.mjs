/**
 * One-shot: snapshot Contentlayer2's document shape into a committed fixture,
 * the same way capture-render-baseline.mjs snapshots its body.html.
 *
 * check-content-shape.mjs compares the loader's output against this. It has to
 * be a committed file rather than a live read of .contentlayer/generated,
 * because .contentlayer is gitignored, is produced only by Contentlayer2, and
 * stops existing the moment Contentlayer2 is uninstalled -- which is the very
 * change the check exists to validate.
 *
 * Only the fields the check compares are stored, so the fixture stays small:
 * body.html is deliberately absent (it is the render harness's job, and it is
 * a throwing getter on the loader side) and body.raw is not copied either.
 *
 * Run BEFORE Contentlayer2 is removed:
 *   node scripts/capture-shape-baseline.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, ".contentlayer", "generated", "Post", "_index.json");
const OUT_DIR = path.join(ROOT, "scripts", "fixtures");
const OUT = path.join(OUT_DIR, "content-shape-baseline.json");

const FIELDS = [
  "title",
  "description",
  "image",
  "imageDesc",
  "draft",
  "featured",
  "tags",
  "slug",
  "urlslug",
  "slugAsParams",
];
const DATE_FIELDS = ["publishDate", "lastmod"];

const posts = JSON.parse(readFileSync(SRC, "utf8"));

const baseline = posts
  .map((post) => {
    const entry = {};
    for (const field of FIELDS) entry[field] = post[field] ?? null;
    for (const field of DATE_FIELDS) entry[field] = post[field] ?? null;
    // Contentlayer omitted `categories` entirely on posts that had none; keep
    // that distinction so the fixture records what actually happened.
    entry.categories = post.categories ?? null;
    return entry;
  })
  .sort((a, b) => a.slug.localeCompare(b.slug));

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, JSON.stringify(baseline, null, 0) + "\n");

console.log(`captured ${baseline.length} post shapes -> ${OUT}`);
