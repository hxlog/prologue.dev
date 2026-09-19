#!/usr/bin/env node
/**
 * Repaint /studio against the semantic status tokens.
 *
 *   text-red-500        -> text-danger
 *   border-red-500/NN   -> border-danger/NN
 *   bg-red-500/NN       -> bg-danger/NN
 *   text-red-600        -> text-danger      (light-only error text)
 *   bg-red-600          -> bg-danger-strong (a fill under white text)
 *   hover:bg-red-500/10 -> hover:bg-danger-soft
 *
 *   text-amber-500      -> text-warn
 *   text-amber-600 dark:text-amber-500 -> text-warn
 *   text-amber-700 dark:text-amber-300/500 -> text-warn
 *   bg-amber-500/NN     -> bg-warn-soft
 *
 *   text-white + gradient-brand / bg-accent  -> .btn-brand
 *
 * `text-amber-600 dark:text-amber-500` is the "same colour, two values so each
 * mode gets one that reads" idiom the studio used before there were tokens for
 * it. Collapsing it to a single `text-warn` is the point of adding the tokens.
 *
 * Idempotent: run it twice and the second run changes nothing.
 *
 *   node scripts/studio/repaint-tokens.mjs [--dry]
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const DRY = process.argv.includes("--dry");

const TARGETS = ["src/app/studio", "src/components/studio"];

/** Ordered — the longer patterns must run before the shorter ones they contain. */
const RULES = [
  // ── the two-value amber idiom, before either single value ──────────────
  [/text-amber-700 dark:text-amber-300/g, "text-warn"],
  [/text-amber-600 dark:text-amber-500/g, "text-warn"],
  [/text-amber-700 dark:text-amber-500/g, "text-warn"],
  [/text-amber-500 dark:text-amber-400/g, "text-warn"],

  // ── danger, the fill first (bg-red-600 is a fill, text-red-500 is text) ─
  [/\bbg-red-600\b/g, "bg-danger-strong"],
  [/\bhover:bg-red-500\/10\b/g, "hover:bg-danger-soft"],
  [/\bbg-red-500\/5\b/g, "bg-danger-soft"],
  [/\bbg-red-500\/10\b/g, "bg-danger-soft"],
  [/\bhover:bg-red-500\/15\b/g, "hover:bg-danger-soft"],
  [/\btext-red-500\b/g, "text-danger"],
  [/\btext-red-600\b/g, "text-danger"],
  [/\btext-red-400\b/g, "text-danger"],
  [/\btext-red-700\b/g, "text-danger"],
  [/\bborder-red-500\/30\b/g, "border-danger/30"],
  [/\bborder-red-500\/40\b/g, "border-danger/40"],
  [/\bborder-red-500\b/g, "border-danger"],

  // ── warning ────────────────────────────────────────────────────────────
  [/\btext-amber-500\b/g, "text-warn"],
  [/\btext-amber-600\b/g, "text-warn"],
  [/\btext-amber-700\b/g, "text-warn"],
  [/\bbg-amber-500\/15\b/g, "bg-warn-soft"],
  [/\bbg-amber-500\/10\b/g, "bg-warn-soft"],
  [/\bborder-amber-500\/40\b/g, "border-warn/40"],

  // ── the diff view's own pair ───────────────────────────────────────────
  [/\btext-red-700 dark:text-red-400\b/g, "text-danger"],
  [/\btext-amber-700 dark:text-amber-300\b/g, "text-warn"],
  [/\bbg-amber-500\/10 text-amber-700 dark:text-amber-300\b/g, "bg-warn-soft text-warn"],
  [/\bbg-red-500\/10 text-red-700 dark:text-red-400\b/g, "bg-danger-soft text-danger"],

  // ── the brand button ───────────────────────────────────────────────────
  //
  // `text-white transition-opacity hover:opacity-90` was the whole treatment,
  // and all three parts of it are wrong for an ink label:
  //
  //   text-white      fails AA on every fill in this palette (1.81:1 in dark)
  //   transition-opacity  transitions the wrong property once the hover is a
  //                       filter — the transition lives on `.btn-brand`
  //   hover:opacity-90    composites the label toward the page and drops the
  //                       ink ratio under AA while the pointer is on it
  //
  // `.btn-brand` carries all three corrections, so the replacement is one
  // token. The `disabled:opacity-*` that follows each one is left alone: it is
  // a different state, and the button's own disabled value reads better than
  // one imposed from the class.
  [/text-white transition-opacity hover:opacity-90/g, "btn-brand"],
];

/**
 * The one exception the brand rule must not touch.
 *
 * `text-white` is CORRECT on the destructive confirm button — its fill is
 * `--danger-strong`, which white clears at 6.47:1 in light and 4.83:1 in dark.
 * `.btn-brand` would repaint that label near-black and drop it to 3.07:1.
 *
 * ## Why the test looks at NEIGHBOURING lines
 *
 * A button's fill is declared two different ways across this tree:
 *
 *   className="… text-white … bg-accent"        the fill is in the same string
 *   className="… text-white …"                  the fill is an inline style,
 *   style={{ background: "var(--gradient-brand)" }}   on the next line
 *
 * so a same-line-only test silently skips half of them (it missed the media
 * library's two and both editors' publish buttons on the first run). The test
 * therefore inspects a small window around the line — wide enough to span a
 * `className` plus the `style` under it, narrow enough that it cannot reach the
 * next element's props, which start at least a `</button>` and an opening tag
 * later.
 *
 * The `danger-strong` exclusion is checked over the same window and wins, so a
 * destructive button that happens to sit near a brand one is left alone.
 */
const BRAND_FILL = /gradient-brand|bg-accent\b/;
const DANGER_FILL = /danger-strong/;
const WINDOW = 4;

/** [start, end) of the lines that could belong to this element's props. */
function windowAround(lines, i) {
  return lines.slice(Math.max(0, i - 1), Math.min(lines.length, i + WINDOW)).join("\n");
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|jsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const files = TARGETS.flatMap((t) => walk(path.resolve(ROOT, t)));
let touched = 0;
const report = [];

for (const file of files) {
  const before = fs.readFileSync(file, "utf8");
  let after = before;
  const hits = [];

  for (const [pattern, replacement] of RULES) {
    if (replacement !== "btn-brand") {
      const found = after.match(pattern);
      if (found) {
        hits.push(`${pattern.source} x${found.length} -> ${replacement}`);
        after = after.replace(pattern, replacement);
      }
      continue;
    }

    // The brand rule is the one that cannot run blind. `text-white` is correct
    // on `--danger-strong` and wrong on a brand fill, and the two live in the
    // same tree, so the rule is applied element by element: it looks at the
    // window of lines around each `text-white`, and converts only where that
    // window names a brand fill and does not name a danger one.
    const lines = after.split("\n");
    let n = 0;
    for (let i = 0; i < lines.length; i++) {
      if (!pattern.test(lines[i])) continue;
      const around = windowAround(lines, i);
      if (DANGER_FILL.test(around) || !BRAND_FILL.test(around)) continue;
      const next = lines[i].replace(pattern, replacement);
      if (next === lines[i]) continue;
      lines[i] = next;
      n++;
    }
    if (n) {
      hits.push(`${pattern.source} x${n} -> ${replacement} (on a brand fill)`);
      after = lines.join("\n");
    }
  }

  if (after === before) continue;
  touched++;
  report.push(`\n${path.relative(ROOT, file).replace(/\\/g, "/")}`);
  for (const h of hits) report.push(`    ${h}`);
  if (!DRY) fs.writeFileSync(file, after);
}

console.log(report.join("\n"));
console.log(`\n${touched} file(s) ${DRY ? "would change" : "changed"} of ${files.length} scanned.`);
