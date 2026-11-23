
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

/**
 * Build-time thumbnail generation.
 *
 * Content images are authored as AVIF/PNG/JPG files under public/static and are
 * content-hashed into public/static/opt by the authoring workflow. This script
 * generates the WebP srcset variants that next/image serves; nothing is encoded
 * at request time any more. Variants are content-hashed too, so a changed source
 * gets a new filename and can be cached immutably.
 *
 * Only images referenced by the content/data/source tree (plus the tiny site
 * chrome under avatars/favicons) are generated; unused files are skipped.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const VARIANTS = path.join(PUBLIC, "static", "variants");
const MANIFEST = path.join(ROOT, "data", "image-variants.js");
const BITMAP = /\.(avif|webp|png|jpe?g)$/i;
const STATIC_RE = /\/static\/(?:[A-Za-z0-9._~!$&'()*+,;=:@%/-]+)\.(?:avif|webp|png|jpe?g|gif|svg)/gi;
const CONTENT_WIDTHS = [480, 720, 1080, 1440, 1920, 2048];
const SMALL_WIDTHS = [64, 96, 128, 256];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function collectReferences() {
  const refs = new Set();
  const roots = [path.join(ROOT, "data"), path.join(ROOT, "src")];
  for (const root of roots) {
    for (const file of walk(root)) {
      if (!/\.(md|mdx|ya?ml|js|mjs|json)$/i.test(file)) continue;
      if (file.endsWith(path.sep + "route-manifest.js")) continue;
      if (file.endsWith(path.sep + "image-sizes.js")) continue;
      if (file.endsWith(path.sep + "image-variants.js")) continue;
      let text;
      try { text = readFileSync(file, "utf8"); } catch { continue; }
      for (const m of text.matchAll(STATIC_RE)) refs.add(m[0]);
    }
  }
  // Small site chrome is constructed from metadata/components; always include it.
  for (const dir of ["avatars", "favicons"]) {
    const full = path.join(PUBLIC, "static", dir);
    if (!existsSync(full)) continue;
    for (const file of walk(full)) {
      refs.add("/static/" + path.relative(path.join(PUBLIC, "static"), file).split(path.sep).join("/"));
    }
  }
  return refs;
}

const refs = collectReferences();
const sources = [];
for (const src of refs) {
  if (!BITMAP.test(src)) continue;
  const file = path.join(PUBLIC, src.replace(/^\//, ""));
  if (!existsSync(file)) continue;
  sources.push({ src, file });
}
sources.sort((a, b) => a.src.localeCompare(b.src));

let previous = {};
try {
  const mod = await import("file://" + MANIFEST.replace(/\\/g, "/") + "?t=" + Date.now());
  previous = mod.IMAGE_VARIANTS || {};
} catch {}

mkdirSync(VARIANTS, { recursive: true });
const manifest = {};
const wantedFiles = new Set();
let generated = 0;
let skipped = 0;
let bytes = 0;
const failures = [];

async function renderVariant(source, out, width) {
  await sharp(source, { failOn: "none" })
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: 72, effort: 3 })
    .toFile(out);
}

for (const { src, file } of sources) {
  let hash;
  try { hash = createHash("sha1").update(readFileSync(file)).digest("hex").slice(0, 12); } catch { continue; }
  const widthsBase = /^\/static\/(avatars|favicons)\//.test(src) || /\/avatar/i.test(src)
    ? SMALL_WIDTHS
    : CONTENT_WIDTHS;
  let meta;
  try { meta = await sharp(file, { failOn: "none" }).metadata(); } catch { continue; }
  const sourceWidth = meta.width || 0;
  const widths = widthsBase.filter((w) => w >= 32 && w > 0 && (!sourceWidth || w <= sourceWidth));
  // If the source is narrower than the smallest/largest configured step, keep a
  // variant at its native width so next/image never falls back to the AVIF
  // original for a small asset.
  if (sourceWidth > 0 && sourceWidth >= 32 && sourceWidth <= widthsBase[widthsBase.length - 1] && !widths.includes(sourceWidth)) {
    widths.push(sourceWidth);
    widths.sort((a, b) => a - b);
  }
  if (!widths.length) continue;
  manifest[src] = { h: hash, widths };
  const prev = previous[src];
  const canReuse = prev && prev.h === hash && JSON.stringify(prev.widths) === JSON.stringify(widths) &&
    widths.every((w) => {
      const p = path.join(VARIANTS, hash + "-" + w + ".webp");
      wantedFiles.add(path.basename(p));
      return existsSync(p);
    });
  if (canReuse) { skipped += 1; continue; }
  for (const width of widths) {
    const out = path.join(VARIANTS, hash + "-" + width + ".webp");
    wantedFiles.add(path.basename(out));
    try {
      await renderVariant(file, out, width);
      generated += 1;
      bytes += statSync(out).size;
    } catch (error) {
      failures.push(src + " @ " + width + ": " + error.message);
    }
  }
}

// Keep the directory tidy: remove variants that no current source needs.
let removed = 0;
for (const name of readdirSync(VARIANTS)) {
  if (!wantedFiles.has(name)) {
    rmSync(path.join(VARIANTS, name), { force: true });
    removed += 1;
  }
}

const source =
  "// GENERATED by scripts/build-image-variants.mjs — do not edit by hand.\n" +
  "export const IMAGE_VARIANTS = " + JSON.stringify(manifest) + ";\n";
let old = "";
try { old = readFileSync(MANIFEST, "utf8"); } catch {}
if (old !== source) writeFileSync(MANIFEST, source);
console.log(
  "image-variants: " + Object.keys(manifest).length + " images, " + generated + " rendered, " +
  skipped + " cached, " + removed + " stale removed, " + (bytes / 1024 / 1024).toFixed(2) + " MB written"
);
if (failures.length) {
  console.error("image-variants failures:\n" + failures.slice(0, 20).join("\n"));
  process.exitCode = 1;
}