/**
 * Renderer parity gate.
 *
 * Renders every Contentlayer-generated post with the new shared
 * renderMarkdown() and diffs the result byte-for-byte against the HTML
 * Contentlayer produced. If this is not 63/63, the renderer is wrong and
 * nothing downstream may be trusted.
 *
 * Usage (from the repo root):
 *   node scripts/db/verify-renderer-parity.mjs [--verbose]
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
// Contentlayer output is a transitional artifact. During the dual-source period
// it may live in a different checkout than this one (e.g. this worktree has no
// .contentlayer/ while the main checkout does), so allow an override.
const SRC = process.env.CONTENTLAYER_ROOT
  ? path.resolve(process.env.CONTENTLAYER_ROOT)
  : ROOT;
const { renderMarkdown, deriveSlugs } = await import(
  pathToFileURL(path.join(ROOT, "src/lib/markdown/render.js")).href
);

const VERBOSE = process.argv.includes("--verbose");

const index = JSON.parse(
  fs.readFileSync(path.join(SRC, ".contentlayer/generated/Post/_index.json"), "utf8")
);

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) {
      return {
        at: i,
        a: a.slice(Math.max(0, i - 70), i + 70),
        b: b.slice(Math.max(0, i - 70), i + 70),
      };
    }
  }
  if (a.length !== b.length) {
    return { at: n, a: a.slice(Math.max(0, n - 70)), b: b.slice(Math.max(0, n - 70)) };
  }
  return null;
}

let pass = 0;
const failures = [];
const start = process.hrtime.bigint();

for (const doc of index) {
  const srcPath = path.join(SRC, "data/content", doc._raw.sourceFilePath);
  const raw = fs.readFileSync(srcPath, "utf8");
  const expected = doc.body.html;

  const { html } = await renderMarkdown(raw);

  if (sha(html) === sha(expected)) {
    pass++;
    continue;
  }

  const d = firstDiff(expected, html);
  failures.push({
    file: doc._raw.sourceFilePath,
    enc: { exp: expected.length, act: html.length },
    diff: d,
  });
}

const ms = Number(process.hrtime.bigint() - start) / 1e6;

console.log("");
console.log("=".repeat(74));
console.log(`  RENDERER PARITY: ${pass}/${index.length} byte-identical   (${ms.toFixed(0)} ms)`);
console.log("=".repeat(74));

if (failures.length === 0) {
  console.log("\n  PASS - output is byte-identical to Contentlayer for every post.");
  console.log("         The markdown pipeline can be safely moved off Contentlayer.\n");
} else {
  console.log(`\n  ${failures.length} post(s) differ:\n`);
  for (const f of failures) {
    console.log(`  FAIL  ${f.file}`);
    console.log(`        length expected=${f.enc.exp} actual=${f.enc.act}`);
    if (f.diff) {
      console.log(`        first diff at char ${f.diff.at}`);
      console.log(`        expected: ${JSON.stringify(f.diff.a)}`);
      console.log(`        actual  : ${JSON.stringify(f.diff.b)}`);
    } else {
      console.log(`        (identical prefix, differing length)`);
    }
    console.log("");
  }
  process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// Slug derivation parity: every route-visible field must match Contentlayer's
// computedFields exactly, or existing URLs would change (an SEO break).
// ---------------------------------------------------------------------------
let slugPass = 0;
const slugFailures = [];
const seenSlugs = new Map();

for (const doc of index) {
  const derived = deriveSlugs(doc._raw.flattenedPath);
  const ok =
    derived.urlslug === doc.urlslug &&
    derived.slug === doc.slug &&
    derived.slugAsParams === doc.slugAsParams;

  if (ok) slugPass++;
  else
    slugFailures.push({
      file: doc._raw.sourceFilePath,
      expected: { urlslug: doc.urlslug, slug: doc.slug, slugAsParams: doc.slugAsParams },
      actual: derived,
    });

  // duplicate slugAsParams would silently shadow a post at its route
  const key = doc.slugAsParams;
  if (seenSlugs.has(key)) {
    slugFailures.push({
      file: doc._raw.sourceFilePath,
      expected: { duplicateOf: seenSlugs.get(key) },
      actual: { slugAsParams: key },
    });
  } else {
    seenSlugs.set(key, doc._raw.sourceFilePath);
  }
}

console.log("-".repeat(74));
console.log(`  SLUG PARITY: ${slugPass}/${index.length} match Contentlayer computedFields`);
console.log("-".repeat(74));

if (slugFailures.length) {
  for (const f of slugFailures) {
    console.log(`  FAIL  ${f.file}`);
    console.log(`        expected ${JSON.stringify(f.expected)}`);
    console.log(`        actual   ${JSON.stringify(f.actual)}`);
  }
  process.exitCode = 1;
} else {
  console.log("  PASS - every derived slug is identical, so no URL changes.\n");
}

if (VERBOSE) {
  console.log("\nSample derived rows:");
  for (const doc of index.slice(0, 5)) {
    console.log(
      `  ${doc._raw.flattenedPath}  ->  slugAsParams=${JSON.stringify(deriveSlugs(doc._raw.flattenedPath).slugAsParams)}`
    );
  }
}
