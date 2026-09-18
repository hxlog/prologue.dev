#!/usr/bin/env node
/**
 * Class-attribute audit for rendered post images.
 *
 * Renders every post through the real pipeline (src/lib/markdown/render.js —
 * the same function publishing and preview both call) and reports the class
 * attributes on the <img> tags it emits.
 *
 * Why this is a script and not a unit test: the defect it guards against is
 * invisible to every other check in the repo. The HTML is valid, the page
 * renders, the image displays. Only the class STRING is wrong, and only in a
 * way that matters at runtime in the browser, where
 * `document.querySelectorAll('img.lightbox-image')` finds nothing and the
 * lightbox silently never binds. Build passes, lint passes, the page looks
 * right, zoom is dead.
 *
 *   node scripts/db/check-figure-classes.mjs
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BLOG_DIR = path.join(ROOT, "data/content/blog");

const { renderMarkdown } = await import(
  new URL("../../src/lib/markdown/render.js", import.meta.url).href
);

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith(".md") ? [full] : [];
  });
}

const IMG_TAG = /<img\b[^>]*>/gi;
const CLASS_ATTR = /\bclass=["']([^"']*)["']/i;

let images = 0;
let withCommas = 0;
let missingLightbox = 0;
let withoutAlt = 0;
const badExamples = [];

for (const file of walk(BLOG_DIR)) {
  const { html } = await renderMarkdown(readFileSync(file, "utf8"));
  const rel = path.relative(ROOT, file);

  for (const tag of html.match(IMG_TAG) ?? []) {
    images++;

    const classMatch = CLASS_ATTR.exec(tag);
    const classes = classMatch ? classMatch[1] : "";
    const names = classes.split(/\s+/).filter(Boolean);

    // A comma is never a valid part of a class name that this repo emits, so
    // its presence means an array was coerced through String() somewhere.
    if (classes.includes(",")) {
      withCommas++;
      if (badExamples.length < 5) badExamples.push(`${rel}\n      ${classes}`);
    }

    if (!names.includes("lightbox-image")) {
      missingLightbox++;
      if (badExamples.length < 5) badExamples.push(`${rel}  (no lightbox-image)\n      ${classes}`);
    } else if (!names.includes("cursor-zoom-in")) {
      missingLightbox++;
      if (badExamples.length < 5) badExamples.push(`${rel}  (no cursor-zoom-in)\n      ${classes}`);
    }

    // The lightbox falls back to alt for its caption; a missing alt is not a
    // failure here, but it is worth knowing how many images have no caption.
    if (!/\balt=["'][^"']+["']/i.test(tag)) withoutAlt++;
  }
}

console.log(`Scanned ${images} rendered <img> tags.`);
console.log(`  comma-joined class attributes: ${withCommas}`);
console.log(`  missing lightbox classes:      ${missingLightbox}`);
console.log(`  no non-empty alt:              ${withoutAlt}`);

if (withCommas || missingLightbox) {
  console.log("\nExamples:");
  for (const example of badExamples) console.log(`  · ${example}`);
  process.exitCode = 1;
} else {
  console.log("\nAll images carry a well-formed lightbox class list.");
}
