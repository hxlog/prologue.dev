#!/usr/bin/env node
/**
 * Frontmatter round-trip guard.
 *
 * The studio edits seven named fields beside a markdown body, but those fields
 * live in one YAML block that the renderer parses as text. The property that
 * makes that safe is:
 *
 *   patchMeta(md, readMeta(md)) === md      -- byte for byte
 *
 * If a single byte moves, then opening a post in the editor and closing it
 * without typing anything has rewritten the file, and with autosave on it has
 * committed that rewrite as a revision. 64 documents, zero tolerance.
 *
 * The second assertion is the one that catches the subtle version: changing ONE
 * field must rewrite exactly one line. A writer that re-serialises the whole
 * block passes assertion 1 and fails this, because it "preserves" every value
 * while reordering every key — a diff that looks like an edit and is not one.
 *
 *   node scripts/db/check-frontmatter-roundtrip.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const CONTENT = path.join(ROOT, "data", "content");

const { readMeta, patchMeta, splitDocument } = await import(
  pathToFileURL(path.join(ROOT, "src/lib/studio/frontmatter-doc.js")).href
);

function walk(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return walk(full);
      return e.name.endsWith(".md") ? [full] : [];
    })
    .sort();
}

const files = walk(CONTENT);

let identityPass = 0;
let oneLinePass = 0;
let noFrontmatter = 0;
const failures = [];

/** Differing lines between two texts, for the report. */
function diffLines(a, b) {
  const la = a.split(/\r?\n/);
  const lb = b.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    if (la[i] !== lb[i]) out.push({ line: i + 1, before: la[i], after: lb[i] });
  }
  return out;
}

for (const file of files) {
  const rel = path.relative(ROOT, file).split(path.sep).join("/");
  const raw = fs.readFileSync(file, "utf8");
  // The importer normalises to LF at the boundary (scripts/db/import-posts.mjs,
  // normalizeEol), so the database — and therefore the editor — only ever sees
  // LF. Comparing the CRLF checkout form directly would measure autocrlf, not
  // this module.
  const source = raw.replace(/\r\n/g, "\n");

  const { block } = splitDocument(source);
  if (block === null) noFrontmatter++;

  // ── 1. identity ─────────────────────────────────────────────────────────
  const meta = readMeta(source);
  const rewritten = patchMeta(source, meta);

  if (rewritten === source) {
    identityPass++;
  } else {
    const diff = diffLines(source, rewritten);
    failures.push({
      file: rel,
      check: "identity",
      detail: `${diff.length} line(s) differ`,
      sample: diff.slice(0, 4),
    });
    continue;
  }

  // ── 2. one field, one line ──────────────────────────────────────────────
  // A value that is guaranteed different from whatever is stored.
  const probe = `roundtrip probe ${files.indexOf(file)}`;
  const once = patchMeta(source, { description: probe });

  const diff = diffLines(source, once);
  if (diff.length === 1) {
    oneLinePass++;
  } else {
    failures.push({
      file: rel,
      check: "one-field-one-line",
      detail: `${diff.length} line(s) differ`,
      sample: diff.slice(0, 6),
    });
  }
}

console.log(`checked          : ${files.length} documents`);
console.log(`no frontmatter   : ${noFrontmatter}`);
console.log(`identity         : ${identityPass}/${files.length}`);
console.log(`one field, one line: ${oneLinePass}/${files.length}`);

if (failures.length) {
  console.log(`\nFAILURES (${failures.length}):`);
  for (const f of failures.slice(0, 15)) {
    console.log(`\n  ${f.file}  [${f.check}]  ${f.detail}`);
    for (const s of f.sample) {
      console.log(`    line ${s.line}`);
      console.log(`      - ${JSON.stringify(s.before)}`);
      console.log(`      + ${JSON.stringify(s.after)}`);
    }
  }
  process.exitCode = 1;
} else {
  console.log("\nOK — every document round-trips byte-identically.");
}
