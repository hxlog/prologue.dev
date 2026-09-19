#!/usr/bin/env node
/**
 * Diff correctness guard.
 *
 * A revision history whose diff is wrong is worse than no history: it tells the
 * author a line changed that did not, and hides the line that did. So this
 * checks the properties that make a diff *usable*, not golden output:
 *
 *   1. Reconstruction — applying the removals and additions to `before` must
 *      reproduce `after` exactly. This is the assertion that catches a broken
 *      backtrack, which is the easy part of Myers to get wrong.
 *   2. Minimality — one changed line in a 450-line document is ONE removal and
 *      ONE addition, not a rewrite of the file.
 *   3. Moves — a relocated block is marked on both sides; a changed duplicate
 *      line is not; blank-line shuffling is not.
 *   4. Context — unchanged runs collapse to gaps, and visible + hidden lines
 *      still add up to the whole document.
 *
 * Note on assertion 1 for unchanged input: `diffDocuments` returns NO rows when
 * the two sides are identical, because "no changes" is what a diff screen
 * should show — not the whole document in grey. Reconstruction is therefore
 * only meaningful when something changed, and the identical case asserts
 * emptiness instead.
 *
 *   node scripts/db/check-diff.mjs
 */

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

const { diffDocuments } = await import(
  pathToFileURL(path.join(ROOT, "src/lib/studio/diff.js")).href
);

let pass = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) pass++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
}

/** Rebuild `after` from a diff's rows. Only sound when rows are non-empty. */
function reconstruct(rows) {
  return rows
    .filter((r) => r.type === "add" || r.type === "context")
    .map((r) => r.text)
    .join("\n");
}

/** Line endings normalised, trailing newline dropped — the canonical form. */
function canon(text) {
  return String(text).replace(/\r\n|\r/g, "\n").replace(/\n$/, "");
}

const cases = [
  { name: "identical", before: "a\nb\nc\n", after: "a\nb\nc\n", identical: true },
  { name: "trailing newline only", before: "a\nb\n", after: "a\nb", identical: true },
  { name: "CRLF vs LF", before: "a\r\nb\r\nc\r\n", after: "a\nb\nc\n", identical: true },
  { name: "one line changed", before: "a\nb\nc\n", after: "a\nB\nc\n", removed: 1, added: 1 },
  { name: "one line added", before: "a\nb\nc\n", after: "a\nb\nx\nc\n", removed: 0, added: 1 },
  { name: "one line removed", before: "a\nb\nc\n", after: "a\nc\n", removed: 1, added: 0 },
  { name: "empty to text", before: "", after: "hello\n", added: 1 },
  { name: "text to empty", before: "hello\n", after: "", removed: 1 },
];

for (const c of cases) {
  const before = canon(c.before);
  const after = canon(c.after);
  const result = diffDocuments(before, after);

  if (c.identical) {
    check(`identical: ${c.name}`, result.identical === true && result.rows.length === 0,
      `identical=${result.identical} rows=${result.rows.length}`);
    check(`identical: ${c.name} stats`, result.stats.added === 0 && result.stats.removed === 0,
      JSON.stringify(result.stats));
    continue;
  }

  check(
    `reconstruct: ${c.name}`,
    reconstruct(result.rows) === after,
    `got ${JSON.stringify(reconstruct(result.rows))}`
  );
  if (c.removed !== undefined) {
    check(
      `removed: ${c.name}`,
      result.stats.removed === c.removed,
      `expected ${c.removed}, got ${result.stats.removed}`
    );
  }
  if (c.added !== undefined) {
    check(
      `added: ${c.name}`,
      result.stats.added === c.added,
      `expected ${c.added}, got ${result.stats.added}`
    );
  }
}

// ── minimality on a realistic document ─────────────────────────────────────
{
  const lines = Array.from({ length: 450 }, (_, i) => `line ${i} of the document`);
  const before = lines.join("\n");
  const next = [...lines];
  next[200] = "LINE 200 CHANGED";
  const after = next.join("\n");

  const result = diffDocuments(before, after);

  check(
    "minimality: one edit in 450 lines is one removal and one addition",
    result.stats.removed === 1 && result.stats.added === 1,
    JSON.stringify(result.stats)
  );

  // Reconstruction is only meaningful on an UNGAPPED diff: with context
  // trimming, the rows deliberately do not contain the whole document. Pass a
  // context large enough that nothing is elided, and assert there.
  const full = diffDocuments(before, after, { context: Number.MAX_SAFE_INTEGER });
  check(
    "context: a huge context window elides nothing",
    !full.rows.some((r) => r.type === "gap"),
    `${full.rows.filter((r) => r.type === "gap").length} gap rows`
  );
  check("minimality: reconstruction exact", reconstruct(full.rows) === after);

  check(
    "context: unchanged runs collapse to gaps",
    result.rows.some((r) => r.type === "gap"),
    "no gap rows"
  );

  // The visible window is `context` lines either side of the two edit rows.
  const contextRows = result.rows.filter((r) => r.type === "context").length;
  check(
    "context: exactly 2*context lines survive around the edit",
    contextRows === 2 * 3,
    `${contextRows} context rows`
  );

  // And the gaps must account for every unchanged line that was elided —
  // 449 unchanged lines, 6 of them shown.
  const hidden = result.rows
    .filter((r) => r.type === "gap")
    .reduce((n, r) => n + r.hidden, 0);
  check(
    "context: gaps account for exactly the elided unchanged lines",
    hidden === 449 - 6,
    `${hidden} hidden, expected ${449 - 6}`
  );
}

// ── moves ──────────────────────────────────────────────────────────────────
{
  // A block relocated from the top to the bottom. Myers reports this as an
  // unrelated delete plus insert; it must be labelled, or a reviewer reading
  // two identical lines marked "changed" concludes the diff is broken.
  const before = ["first", "second", "third", "alpha", "beta", "gamma"].join("\n");
  const after = ["alpha", "beta", "gamma", "first", "second", "third"].join("\n");

  const result = diffDocuments(before, after);
  const movedRows = result.rows.filter((r) => r.moved);
  check("moves: a relocated block is marked moved", movedRows.length > 0,
    `${movedRows.length} moved rows`);
  check("moves: reconstruction exact", reconstruct(result.rows) === after);
}

{
  // A duplicate line where only one instance changes must NOT be a move. This
  // is the false positive that makes a diff cry wolf.
  const result = diffDocuments("dup\nkeep\nkeep\nend", "dup\nCHANGED\nkeep\nend");
  const moved = result.rows.filter((r) => r.moved).length;
  check("moves: a changed duplicate is not a move", moved === 0, `${moved} rows marked moved`);
  check("moves: reconstruction exact", reconstruct(result.rows) === "dup\nCHANGED\nkeep\nend");
}

{
  // Inserting a blank line is not a relocation of anything.
  const result = diffDocuments("a\nb", "a\n\nb");
  const moved = result.rows.filter((r) => r.moved).length;
  check("moves: inserting a blank line is not a move", moved === 0, `${moved} moved`);
}

// ── oversized guard ────────────────────────────────────────────────────────
{
  const big = Array.from({ length: 5000 }, (_, i) => `x${i}`).join("\n");
  const result = diffDocuments(big, `${big}\nmore`);
  check("limit: an oversized document is refused, not hung", result.truncated === true);
}

// ── the real corpus: every post against itself, and one word changed ───────
{
  const fs = await import("node:fs");
  const CONTENT = path.join(ROOT, "data", "content");

  const walk = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return walk(full);
      return e.name.endsWith(".md") ? [full] : [];
    });

  const files = walk(CONTENT);
  let selfClean = 0;
  let selfDirty = 0;
  let oneWordClean = 0;

  for (const file of files) {
    const source = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");

    const same = diffDocuments(source, source);
    if (same.identical && same.rows.length === 0) selfClean++;
    else selfDirty++;

    // Change one character in the middle, and require exactly one line pair.
    const at = Math.floor(source.length / 2);
    const edited = source.slice(0, at) + "x" + source.slice(at);
    const d = diffDocuments(source, edited);
    if (d.stats.added === 1 && d.stats.removed === 1) oneWordClean++;
  }

  check("corpus: every document diffs clean against itself", selfDirty === 0,
    `${selfDirty} of ${files.length} not identical`);
  check("corpus: a one-character edit is one line pair in every document",
    oneWordClean === files.length, `${oneWordClean}/${files.length}`);
  console.log(`corpus: ${files.length} documents, ${selfClean} self-clean, ${oneWordClean} minimal`);
}

console.log(`\nassertions: ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  FAIL  ${f}`);
  process.exitCode = 1;
} else {
  console.log("OK — the diff reconstructs `after` on every case.");
}
