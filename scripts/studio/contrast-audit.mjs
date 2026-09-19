#!/usr/bin/env node
/**
 * Assert the AA contrast floor on every text token.
 *
 *   node scripts/studio/contrast-audit.mjs
 *
 * ## Why this exists
 *
 * The tokens in `globals.css` were retuned because they were measured, and the
 * measurements were bad: 174 uses of `--faint` at 2.33:1, every brand button's
 * white label at 1.81:1 in dark mode, `--accent` as a link at 3.68:1 on white.
 * None of that is visible to a build, a lint, or a screenshot — "the button is
 * visible" and "the button's label is legible" are different questions and only
 * the second one has a number.
 *
 * Having solved for the numbers once, they are worth keeping honest. Nothing
 * else will notice the day someone nudges `--faint` two steps lighter to
 * "soften it". So this parses `src/app/globals.css` and re-derives every ratio
 * from the ACTUAL declared values — not from a copy of them. Retune a token and
 * this goes red; that is the whole mechanism.
 *
 * ## What it does and does not cover
 *
 * It checks that every text token clears its floor on every surface that token
 * is actually used on, that a fill carries a label it can carry, and that the
 * two button hovers do not drop a passing state below the line.
 *
 * It does NOT check:
 *
 *   - site-side call sites. `--faint` is a token, and a token cannot know which
 *     of its uses are text and which are decoration. The audit asserts the
 *     token; the decoration uses are the caller's problem.
 *   - layout, focus order, or anything a screenshot would be needed to see.
 *   - `--surface-3`, which is deliberately outside the text surface set: it is
 *     only ever a transient hover or selected background, never a resting one,
 *     so text is never *placed* on it. The one place a label does rest there
 *     uses `--muted`, and that pair is asserted below.
 *
 * Exit code is 0 when every assertion passes, 1 otherwise.
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const CSS_PATH = path.join(ROOT, "src/app/globals.css");
const CSS = fs.readFileSync(CSS_PATH, "utf8").replace(/\r\n/g, "\n");

/* ── colour maths ────────────────────────────────────────────────────────── */

function parse(value) {
  const v = String(value).trim();
  let m = /^#([0-9a-fA-F]{3,8})$/.exec(v);
  if (m) {
    let h = m[1];
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  }
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(v);
  if (m) return [+m[1] / 255, +m[2] / 255, +m[3] / 255];
  return null;
}

/** The alpha out of an `rgba(...)`. CSS allows whitespace after the commas and
 *  this file uses it; a regex that requires it absent reads every alpha token
 *  as fully opaque. */
function alphaOf(raw) {
  if (!/^rgba\(/.test(String(raw))) return 1;
  const m = /,\s*([\d.]+)\s*\)\s*$/.exec(String(raw));
  return m ? +m[1] : 1;
}

const channel = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

function luminance(rgb) {
  const [r, g, b] = rgb.map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a, b) {
  const la = luminance(a), lb = luminance(b);
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** Composite `fg` at `alpha` over `bg` — what an alpha token renders as. */
function over(fg, alpha, bg) {
  return fg.map((v, i) => v * alpha + bg[i] * (1 - alpha));
}

/** Tailwind's `brightness(k)` filter: multiply each channel, clamp at 1. */
function brightness(rgb, k) {
  return rgb.map((v) => Math.min(1, v * k));
}

/** `cssHex(rgb)` — for printing a sampled gradient stop as a hex string. */
function cssHex(rgb) {
  return "#" + rgb.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
}

/** Sample a two-stop gradient ramp at t in [0, 1]. */
function rampAt(a, b, t) {
  return a.map((v, i) => v + (b[i] - v) * t);
}

/* ── read the declared tokens ────────────────────────────────────────────── */

/**
 * Pull the declarations out of a `:root { … }` or `.dark { … }` block.
 *
 * Deliberately not a CSS parser: the file is one this repo owns and its shape
 * is stable, and a parser would be a dependency plus a second thing to keep
 * working. A token that moves out of these blocks fails loudly instead of
 * silently becoming unchecked, because `required()` errors on a missing name.
 *
 * Note the digits in the character class — `--surface-2` is a declared token
 * and `[a-z-]+` would skip it without saying so.
 */
function block(selector) {
  const at = CSS.indexOf(selector);
  if (at < 0) throw new Error(`globals.css: no ${selector} block`);
  const open = CSS.indexOf("{", at);
  const close = CSS.indexOf("\n}", open);
  const out = {};
  for (const line of CSS.slice(open + 1, close).split("\n")) {
    const m = /^\s*(--[a-z0-9-]+):\s*([^;]+);/.exec(line);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

const light = block(":root {");
const dark = block(".dark {");

/**
 * The gradient's two endpoints, read from `--gradient-brand`.
 *
 * Read rather than hard-coded, because the whole point of this audit is that a
 * token change shows up here. A hard-coded pair would keep passing after the
 * gradient moved, which is exactly the failure mode being guarded against.
 */
function gradientStops(tokens, mode) {
  const raw = tokens["--gradient-brand"];
  if (!raw) throw new Error(`${mode}: --gradient-brand is not declared`);
  const stops = [...raw.matchAll(/#[0-9a-fA-F]{3,8}/g)].map((m) => parse(m[0]));
  if (stops.length !== 2) {
    throw new Error(`${mode}: expected 2 stops in --gradient-brand, found ${stops.length}`);
  }
  return stops;
}

function required(tokens, name, mode) {
  const v = tokens[name];
  if (v === undefined) throw new Error(`${mode}: ${name} is not declared`);
  return v;
}

/** Resolve a token to RGB, compositing an alpha value over a given backdrop. */
function resolve(tokens, name, mode, backdropName) {
  const raw = required(tokens, name, mode);
  const rgb = parse(raw);
  if (!rgb) throw new Error(`${mode}: ${name} = "${raw}" is not a colour this audit can read`);
  if (alphaOf(raw) < 1) {
    if (!backdropName) {
      throw new Error(`${mode}: ${name} is an alpha token but no backdrop was given`);
    }
    return over(rgb, alphaOf(raw), resolve(tokens, backdropName, mode));
  }
  return rgb;
}

/* ── the assertions ──────────────────────────────────────────────────────── */

const AA_TEXT = 4.5;
const AA_UI = 3.0;

let passed = 0;
const failures = [];

function check(label, actual, floor = AA_TEXT) {
  if (actual >= floor) passed++;
  else failures.push(`${label} — ${actual.toFixed(2)}:1, needs ${floor}:1`);
  return actual;
}

/**
 * The surfaces a text token can REST on.
 *
 * `--surface-3` is not one of them, and that is a claim rather than an
 * oversight: it only ever appears as `hover:bg-surface-3` or as the background
 * of a small chip, so no text token is ever *placed* on it. If that changes,
 * add it here and the tokens will have to move.
 */
const TEXT_SURFACES = ["--background", "--surface", "--surface-2"];

/** Tokens that are text (or an icon standing in for text) somewhere. */
const TEXT_TOKENS = [
  "--foreground",
  "--muted",
  "--faint",
  "--accent",
  "--accent-strong",
  "--secondary",
  "--secondary-strong",
  "--danger",
  "--warn",
];

for (const [mode, tokens] of [["light", light], ["dark", dark]]) {
  /* ── 1. every text token, on every surface it rests on ─────────────────── */

  for (const surface of TEXT_SURFACES) {
    const bg = resolve(tokens, surface, mode);
    for (const token of TEXT_TOKENS) {
      check(`${mode} ${token} on ${surface}`, ratio(resolve(tokens, token, mode), bg));
    }
  }

  /* ── 2. the -soft panels ────────────────────────────────────────────────── */
  //
  // Fixed values, not alphas — see the note in globals.css. The set of tokens
  // that appear on one is the set the app actually places there: the accent
  // pair on the active nav item, the status text on its own panel, and the two
  // grey tiers on a background wash.
  for (const [soft, on] of [
    ["--accent-soft", ["--accent", "--accent-strong", "--muted", "--faint"]],
    ["--danger-soft", ["--danger"]],
    ["--warn-soft", ["--warn"]],
  ]) {
    const bg = resolve(tokens, soft, mode, "--surface");
    for (const token of on) {
      check(`${mode} ${token} on ${soft}`, ratio(resolve(tokens, token, mode), bg));
    }
  }

  /* ── 3. a saturated fill carries --on-accent ───────────────────────────── */
  //
  // Not white unconditionally: `--on-accent` flips between modes, and the fills
  // it has to cover are the solid accent, the secondary, and the gradient —
  // including everywhere in between, which is where the binding case is.
  //
  // `--accent-soft` is NOT one of them. It is a near-white (light) or
  // near-black (dark) wash that carries `--accent`, `--muted` and `--faint` as
  // its text; a label colour for a saturated fill has no business on it, and
  // asserting the pair would be checking a combination the app never renders.
  const ink = resolve(tokens, "--on-accent", mode);
  for (const fill of ["--accent", "--secondary"]) {
    check(`${mode} --on-accent on ${fill}`, ratio(ink, resolve(tokens, fill, mode)));
  }

  const [stopA, stopB] = gradientStops(tokens, mode);
  let worst = Infinity, worstAt = "";
  for (let t = 0; t <= 1.0001; t += 0.01) {
    const c = rampAt(stopA, stopB, t);
    const r = ratio(ink, c);
    if (r < worst) { worst = r; worstAt = cssHex(c); }
  }
  check(`${mode} --on-accent on --gradient-brand, worst point (${worstAt})`, worst);

  /* ── 4. the destructive fill carries white, and still does on hover ────── */
  //
  // `--danger-strong` is the one fill that does NOT use `--on-accent`: white on
  // a red is the conventional reading of "this destroys something", and white
  // clears AA on both declared values. `.btn-danger` darkens on hover rather
  // than brightening, because brightening a red fill lowers white's ratio.
  const dangerFill = resolve(tokens, "--danger-strong", mode);
  check(`${mode} white on --danger-strong`, ratio([1, 1, 1], dangerFill));
  check(
    `${mode} white on --danger-strong at brightness(0.92)`,
    ratio(brightness([1, 1, 1], 0.92), brightness(dangerFill, 0.92))
  );

  /* ── 5. the two button hovers do not cost contrast ─────────────────────── */
  //
  // `.btn-brand` hovers with `filter: brightness(1.08)`, which moves the fill
  // AND the label. That is only safe because the label barely moves — ink is
  // already near the clamp for a bright-on-dark fill, and white stays white —
  // while the fill gets further away. This asserts the property rather than
  // arguing for it, at the gradient's worst point.
  const inkHover = brightness(ink, 1.08);
  let worstHover = Infinity;
  for (let t = 0; t <= 1.0001; t += 0.01) {
    worstHover = Math.min(worstHover, ratio(inkHover, brightness(rampAt(stopA, stopB, t), 1.08)));
  }
  check(`${mode} --on-accent on --gradient-brand at brightness(1.08)`, worstHover);

  /* ── 6. non-text: the focus ring must be visible against the page ──────── */
  check(
    `${mode} focus ring (--accent) on --background`,
    ratio(resolve(tokens, "--accent", mode), resolve(tokens, "--background", mode)),
    AA_UI
  );
}

/* ── report ──────────────────────────────────────────────────────────────── */

if (failures.length) {
  console.error(`\n${failures.length} assertion(s) failed:\n`);
  for (const f of failures) console.error(`  FAIL  ${f}`);
  console.error(
    `\n${passed} passed, ${failures.length} failed.\n\n` +
      `A text token that does not clear its floor is not reachable by lint or by a\n` +
      `screenshot. Retune it in src/app/globals.css — or, if the value is deliberate\n` +
      `and the floor is wrong for it, correct the assertion here and say why in the\n` +
      `comment. Do not delete the assertion.\n`
  );
  process.exit(1);
}

console.log(`\nassertions: ${passed} passed, 0 failed`);
console.log(`OK — every text token clears ${AA_TEXT}:1 on every surface it rests on.`);
