#!/usr/bin/env node
/**
 * Build the local assets /og needs at request time.
 *
 * The Open Graph route used to fetch a Google Fonts `text=` subset per card
 * (three weights = three CSS hits + three TTF hits) and to resize the 871 KB
 * author avatar with sharp on every cold start. Both are pure build-time work:
 * the glyphs the card can draw come from the content tree, and the avatar is a
 * fixed 152 px square. Doing them here removes every network round trip and the
 * libvips load from the request path.
 *
 * What it writes, all under `assets/og/`:
 *
 *   NotoSansSC-400.ttf / -600.ttf / -700.ttf
 *       The three card weights, subset to the union of every character the card
 *       can currently draw (post/page titles, tag labels, author, blog name,
 *       domain, formatted dates, reading-time labels, the `+N` chip). Google's
 *       subsetter produces a ~120 KB TTF per weight, so the three files are
 *       ~380 KB — smaller than the 871 KB source avatar they replace.
 *   glyphs.json
 *       The codepoints the three fonts actually contain (intersection of their
 *       cmap tables). /og checks the drawn text against this at request time:
 *       if a title carries a character the subset does not have, the route
 *       falls back to the old per-card Google subset instead of drawing tofu.
 *   avatar-152.png
 *       The author avatar, resized exactly as the route used to do it with
 *       sharp (`resize(152, 152, { fit: "cover", position: "centre" })`,
 *       PNG compression level 9). Same pipeline, byte-identical output, but
 *       run once instead of on every render.
 *
 * Run it from the repo root whenever the card's glyph repertoire changes
 * (new posts/pages, a new tag label, a new author or site name):
 *
 *   node scripts/build-og-font.mjs
 *
 * It is maintenance tooling, not part of `dev`/`build`: the generated files are
 * committed, and the template publish script deletes this file. Network access
 * to fonts.googleapis.com is required; a weight that fails after one retry is
 * skipped with a warning (the report says which), and /og then falls back to the
 * per-card Google subset for that weight.
 */

import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import siteMetadata from "../data/sitemetadata.js";
import tagLabels from "../data/tagLabels.js";
import { formatDate, readingTimeLabel } from "../src/lib/date.js";
import { getPages, getPosts } from "../src/lib/content/standalone.js";

// Weights the card draws with: 400 meta row, 600 title/author/+N, 700 the
// initial-letter avatar. Keep in sync with `loadLocalFonts` in
// src/app/og/route.js.
const WEIGHTS = [400, 600, 700];

// Which Google Fonts endpoint returns a TTF: the CSS2 API picks the format from
// the User-Agent, and a legacy UA is served `format('truetype')` instead of
// woff2 (which Satori cannot parse).
const LEGACY_UA =
  "Mozilla/5.0 (BB10; Touch) AppleWebKit/537.1+ (KHTML, like Gecko) Version/10.0.0.1337 Mobile Safari/537.1+";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "assets", "og");

const POSTS = getPosts();
const PAGES = getPages();

console.log(
  `[og] collecting glyphs from ${POSTS.length} posts, ${PAGES.length} pages, ` +
    `${Object.keys(tagLabels).length} tag labels`
);

const glyphs = new Set();
const add = (value) => {
  for (const char of String(value ?? "")) glyphs.add(char);
};

for (const post of POSTS) {
  add(post.title);
  for (const tag of post.tags || []) {
    // The card shows the Chinese label, but `tagLabel()` falls back to the raw
    // slug for an unmapped tag, so both the slug and the label are drawn.
    add(tag);
    add(tagLabels[tag] || "");
  }
  add(formatDate(post.publishDate));
}
for (const page of PAGES) add(page.title);

// The card's fixed strings.
add(siteMetadata.publishName);
add(siteMetadata.title);
add(siteMetadata.siteName);
add(siteMetadata.author);
add(domain(siteMetadata.siteUrl));

// Dates and reading times are generated at request time from those building
// blocks; enumerate the alphabet they can emit rather than one instance.
add("0123456789年月日");
for (let minutes = 1; minutes <= 999; minutes += 1) {
  add(readingTimeLabel({ minutes }));
}
add("+0123456789");

// A card URL is public (`/og?title=…`), so any printable ASCII can arrive even
// though the site's own content is CJK. Latin glyphs are a few hundred bytes
// each in the subset, and the coverage check in /og keeps anything rarer on the
// old remote path.
for (let code = 32; code < 127; code += 1) add(String.fromCharCode(code));
add(" ");
add("，。、；：？！…—·“”‘’（）《》【】「」");

const text = [...glyphs].join("");
console.log(`[og] ${glyphs.size} unique glyphs (${Buffer.byteLength(text)} UTF-8 bytes)`);

await mkdir(OUT_DIR, { recursive: true });

const fontPaths = new Map();
const fontBuffers = new Map();

for (const weight of WEIGHTS) {
  const buffer = await fetchWeight(weight, text);
  if (!buffer) {
    console.warn(`[og] weight ${weight} unavailable — skipped (route will use the remote subset)`);
    continue;
  }
  const file = path.join(OUT_DIR, `NotoSansSC-${weight}.ttf`);
  await writeFile(file, buffer);
  fontPaths.set(weight, file);
  fontBuffers.set(weight, buffer);
  console.log(`[og] ${path.relative(ROOT, file).split(path.sep).join("/")} — ${bytes(buffer.length)}`);
}

const coverage = intersectCoverage(fontBuffers);
if (coverage.length) {
  const glyphFile = path.join(OUT_DIR, "glyphs.json");
  const payload = {
    comment:
      "Generated by scripts/build-og-font.mjs — do not edit. Codepoints present in every generated weight; /og uses this to decide between the local fonts and the remote per-card subset.",
    weights: [...fontBuffers.keys()],
    count: coverage.length,
    codepoints: coverage,
  };
  await writeFile(glyphFile, JSON.stringify(payload) + "\n");
  console.log(
    `[og] ${path.relative(ROOT, glyphFile).split(path.sep).join("/")} — ${bytes(Buffer.byteLength(JSON.stringify(payload)))} covering ${coverage.length} codepoints`
  );
} else {
  console.warn("[og] no font weight available — glyphs.json not written");
}

await buildAvatar();

const fontTotal = [...fontBuffers.values()].reduce((sum, buffer) => sum + buffer.length, 0);
console.log(`[og] total font payload: ${bytes(fontTotal)}`);
if (fontTotal > 4 * 1024 * 1024) {
  console.warn("[og] WARNING: local fonts exceed 4 MB — /og should stay a small function");
}

/* ------------------------------------------------------------------ fonts */

/**
 * Fetch one weight, subset to `text`, as a TTF.
 *
 * Google's CSS endpoint answers with an `@font-face` whose `src` is the TTF.
 * Retried once per weight; a second failure returns null so the other weights
 * still build (a partial set degrades /og to the remote path, it does not ship
 * broken type).
 */
async function fetchWeight(weight, text) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const cssUrl =
        "https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@" +
        weight +
        "&text=" +
        encodeURIComponent(text);
      const cssResponse = await fetch(cssUrl, {
        headers: { "User-Agent": LEGACY_UA },
      });
      if (!cssResponse.ok) throw new Error(`CSS HTTP ${cssResponse.status}`);
      const css = await cssResponse.text();
      const match = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/);
      if (!match) throw new Error("no TTF src in the returned @font-face");

      const fontResponse = await fetch(match[1]);
      if (!fontResponse.ok) throw new Error(`font HTTP ${fontResponse.status}`);
      const buffer = Buffer.from(await fontResponse.arrayBuffer());
      if (!isSfnt(buffer)) throw new Error("response is not a TrueType/OpenType file");
      return buffer;
    } catch (error) {
      console.warn(
        `[og] weight ${weight} attempt ${attempt}/2 failed: ${error.message}`
      );
    }
  }
  return null;
}

/** TTF/OTF magic: 0x00010000, 'true', 'ttcf' or 'OTTO'. */
function isSfnt(buffer) {
  if (!buffer || buffer.length < 12) return false;
  const tag = buffer.readUInt32BE(0);
  return tag === 0x00010000 || tag === 0x74727565 || tag === 0x4f54544f || tag === 0x74746366;
}

/**
 * Codepoints common to every generated weight.
 *
 * Parsed from the fonts' own cmap tables rather than assumed from the requested
 * text: Google silently drops characters the face does not contain, and a
 * false-positive coverage entry would draw tofu on a card.
 */
function intersectCoverage(buffers) {
  const sets = [...buffers.values()].map(cmapCodepoints);
  if (!sets.length) return [];
  const [first, ...rest] = sets;
  return [...first]
    .filter((code) => rest.every((set) => set.has(code)))
    .sort((a, b) => a - b);
}

/* ------------------------------------------------------------------- cmap */

/** Read the Unicode codepoints a font's cmap maps to a real (non-.notdef) glyph. */
function cmapCodepoints(buffer) {
  const fallback = new Set();
  if (!isSfnt(buffer)) return fallback;

  // Table directory: numTables at 4, records start at 12, 16 bytes each.
  const numTables = buffer.readUInt16BE(4);
  let cmapOffset = 0;
  for (let i = 0; i < numTables; i += 1) {
    const record = 12 + i * 16;
    if (buffer.toString("latin1", record, record + 4) === "cmap") {
      cmapOffset = buffer.readUInt32BE(record + 8);
      break;
    }
  }
  if (!cmapOffset) return fallback;

  const subtableCount = buffer.readUInt16BE(cmapOffset + 2);
  const seen = new Set();
  for (let i = 0; i < subtableCount; i += 1) {
    const record = cmapOffset + 4 + i * 8;
    const platformID = buffer.readUInt16BE(record);
    const encodingID = buffer.readUInt16BE(record + 2);
    const unicode =
      platformID === 0 || (platformID === 3 && (encodingID === 1 || encodingID === 10));
    if (!unicode) continue;
    const subtable = cmapOffset + buffer.readUInt32BE(record + 4);
    if (seen.has(subtable)) continue;
    seen.add(subtable);
    const format = buffer.readUInt16BE(subtable);
    if (format === 4) readFormat4(buffer, subtable, fallback);
    else if (format === 12) readFormat12(buffer, subtable, fallback);
    else if (format === 6) readFormat6(buffer, subtable, fallback);
  }
  return fallback;
}

function readFormat4(buffer, offset, out) {
  const segCount = buffer.readUInt16BE(offset + 6) / 2;
  const endCodes = offset + 14;
  const startCodes = endCodes + segCount * 2 + 2;
  const idDeltas = startCodes + segCount * 2;
  const idRangeOffsets = idDeltas + segCount * 2;

  for (let i = 0; i < segCount; i += 1) {
    const end = buffer.readUInt16BE(endCodes + i * 2);
    const start = buffer.readUInt16BE(startCodes + i * 2);
    const delta = buffer.readInt16BE(idDeltas + i * 2);
    const rangeOffset = buffer.readUInt16BE(idRangeOffsets + i * 2);
    if (start > end) continue;
    for (let code = start; code <= end && code !== 0xffff; code += 1) {
      let glyph;
      if (rangeOffset === 0) {
        glyph = (code + delta) & 0xffff;
      } else {
        const glyphAddress = idRangeOffsets + i * 2 + rangeOffset + (code - start) * 2;
        if (glyphAddress + 2 > buffer.length) continue;
        const raw = buffer.readUInt16BE(glyphAddress);
        glyph = raw === 0 ? 0 : (raw + delta) & 0xffff;
      }
      if (glyph !== 0) out.add(code);
    }
  }
}

function readFormat12(buffer, offset, out) {
  const groupCount = buffer.readUInt32BE(offset + 12);
  for (let i = 0; i < groupCount; i += 1) {
    const group = offset + 16 + i * 12;
    const start = buffer.readUInt32BE(group);
    const end = buffer.readUInt32BE(group + 4);
    for (let code = start; code <= end; code += 1) out.add(code);
  }
}

function readFormat6(buffer, offset, out) {
  const first = buffer.readUInt16BE(offset + 6);
  const count = buffer.readUInt16BE(offset + 8);
  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt16BE(offset + 10 + i * 2) !== 0) out.add(first + i);
  }
}

/* ----------------------------------------------------------------- avatar */

/**
 * The 152 px avatar, byte-identical to what /og used to compute with sharp on
 * each cold start: same `fit`/`position`, same PNG compression.
 */
async function buildAvatar() {
  const source = path.join(ROOT, "public", String(siteMetadata.avatar || "").replace(/^\/+/, ""));
  const target = path.join(OUT_DIR, "avatar-152.png");
  try {
    const png = await sharp(readFileSync(source))
      .resize(152, 152, { fit: "cover", position: "centre" })
      .png({ compressionLevel: 9 })
      .toBuffer();
    await writeFile(target, png);
    console.log(
      `[og] ${path.relative(ROOT, target).split(path.sep).join("/")} — ${bytes(png.length)} (from ${bytes(readFileSync(source).length)} source)`
    );
  } catch (error) {
    console.warn(`[og] avatar skipped: ${error.message}`);
  }
}

/* ------------------------------------------------------------------ utils */

function domain(value) {
  return String(value || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

function bytes(value) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}
