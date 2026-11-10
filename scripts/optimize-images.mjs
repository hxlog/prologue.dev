/**
 * One-off image recompression for prologue.dev (maintainer script, not shipped).
 *
 * `node scripts/optimize-images.mjs`          -> dry run, prints the plan
 * `node scripts/optimize-images.mjs --apply`  -> writes public/static/opt/**,
 *                                                rewrites every reference,
 *                                                deletes the originals it replaced
 *
 * Rules (quality-first, see docs/audit/report.md):
 *   - PIXEL DIMENSIONS ARE NEVER REDUCED. The lightbox upgrades to the largest
 *     srcset candidate, so the source's native width is the sharpness ceiling.
 *   - stills  -> AVIF, q 65, effort 4, 4:2:0
 *   - animated-> animated WebP, q 82 (AVIF animation is unsupported in some
 *                readers; WebP keeps the frames)
 *   - files <= 200 KB, .svg, .ico and public/static/{favicons,avatars} are left
 *     alone: they are metadata/feed/OG inputs where a rename would ripple.
 */
import { readdirSync, statSync, writeFileSync, unlinkSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";

const ROOT = process.cwd();
const APPLY = process.argv.includes("--apply");
const MIN_BYTES = 200 * 1024;
const OUT_DIR = path.join(ROOT, "public", "static", "opt");
const MAP_FILE = path.join(ROOT, ".tmp", "lead", "image-map.json");
const STILL_RE = /\.(png|jpe?g|webp)$/i;
const ANIM_RE = /\.gif$/i;
const SKIP_DIRS = [path.join("public", "static", "favicons"), path.join("public", "static", "avatars")];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function publicPath(full) {
  return "/" + path.relative(path.join(ROOT, "public"), full).split(path.sep).join("/");
}

const files = walk(path.join(ROOT, "public")).filter((full) => {
  const rel = path.relative(ROOT, full);
  if (SKIP_DIRS.some((d) => rel.startsWith(d + path.sep))) return false;
  if (!STILL_RE.test(full) && !ANIM_RE.test(full)) return false;
  return statSync(full).size >= MIN_BYTES;
});

if (!APPLY) {
  console.log("planned: " + files.length + " files");
  for (const full of files) console.log((statSync(full).size / 1024).toFixed(0).padStart(6) + " KB  " + publicPath(full));
  process.exit(0);
}

mkdirSync(OUT_DIR, { recursive: true });
const map = {};
let before = 0;
let after = 0;

for (const full of files) {
  const from = publicPath(full);
  const size = statSync(full).size;
  const base = path.basename(full, path.extname(full)).replace(/[^A-Za-z0-9._-]+/g, "-");
  const hash = createHash("sha1").update(readFileSync(full)).digest("hex").slice(0, 8);
  const animated = ANIM_RE.test(full);

  const encoded = animated
    ? await sharp(full, { animated: true }).webp({ quality: 78, effort: 4 }).toBuffer()
    : await sharp(full).avif({ quality: 76, effort: 4, chromaSubsampling: "4:2:0" }).toBuffer();

  const ext = animated ? "webp" : "avif";
  const to = "/static/opt/" + base + "-" + hash + "." + ext;
  writeFileSync(path.join(ROOT, "public", to.replace(/^\//, "")), encoded);

  before += size;
  after += encoded.length;
  map[from] = to;
  console.log(
    (size / 1024).toFixed(0).padStart(6) + " KB -> " + (encoded.length / 1024).toFixed(0).padStart(4) +
    " KB  " + from + "  =>  " + to
  );
}

writeFileSync(MAP_FILE, JSON.stringify(map, null, 2));

// Rewrite references everywhere the content tree or the app can name them.
const TEXT_EXT = /\.(md|mdx|ya?ml|js|mjs|json)$/i;
const REF_ROOTS = ["data", "src", "template/data", "docs"];
const targets = [];
for (const rel of REF_ROOTS) {
  const dir = path.join(ROOT, rel);
  if (!existsSync(dir)) continue;
  for (const full of walk(dir)) if (TEXT_EXT.test(full)) targets.push(full);
}

let touchedFiles = 0;
let replacedRefs = 0;
for (const full of targets) {
  const original = readFileSync(full, "utf8");
  let next = original;
  for (const [from, to] of Object.entries(map)) {
    if (next.includes(from)) {
      const count = next.split(from).length - 1;
      next = next.split(from).join(to);
      replacedRefs += count;
    }
  }
  if (next !== original) {
    writeFileSync(full, next);
    touchedFiles += 1;
  }
}

// Only delete an original once no text file still names it.
const survivors = targets.filter((full) => {
  const text = readFileSync(full, "utf8");
  return Object.keys(map).some((from) => text.includes(from));
});
let removed = 0;
if (survivors.length === 0) {
  for (const from of Object.keys(map)) {
    unlinkSync(path.join(ROOT, "public", from.replace(/^\//, "")));
    removed += 1;
  }
}

console.log("---");
console.log("files: " + files.length + ", " + (before / 1048576).toFixed(1) + " MB -> " + (after / 1048576).toFixed(1) + " MB");
console.log("refs rewritten: " + replacedRefs + " in " + touchedFiles + " files");
console.log("originals deleted: " + removed + (survivors.length ? " (SKIPPED: " + survivors.length + " files still reference originals)" : ""));
if (survivors.length) for (const s of survivors.slice(0, 10)) console.log("  still referenced by " + path.relative(ROOT, s));
