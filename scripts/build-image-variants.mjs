
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

/**
 * Build-time responsive image generation: AVIF (first) + WebP (fallback).
 *
 * Content images are authored as AVIF/PNG/JPG files under public/static and are
 * content-hashed into public/static/opt by the authoring workflow. This script
 * generates two srcset families per referenced bitmap:
 *
 *   public/static/variants/<hash>-<width>.avif   (q60, effort 4)
 *   public/static/variants/<hash>-<width>.webp   (q80, effort 4)
 *
 * and data/image-variants.js, which <ResponsiveImage> turns into
 * <picture><source type="image/avif"><source type="image/webp"><img></picture>.
 * Nothing is encoded at request time. Variants are content-hashed too, so a
 * changed source gets a new filename and can be cached immutably.
 *
 * Only images referenced by the content/data/source tree (plus the tiny site
 * chrome under avatars/favicons) are generated; unused files are skipped.
 *
 * CACHE: re-running is a no-op when nothing changed. A per-entry hash +
 * widths + the manifest-level IMAGE_VARIANTS_ENCODER signature must all match
 * and every expected file must exist; otherwise only the missing/re-encoded
 * files are written.
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
const FORMATS = [
	{ name: "avif", ext: "avif", encode: (pipeline) => pipeline.avif({ quality: 60, effort: 4 }) },
	{ name: "webp", ext: "webp", encode: (pipeline) => pipeline.webp({ quality: 80, effort: 4 }) },
];
// Bump when encoder settings change so previously generated files are re-encoded
// even though their filenames are unchanged.
const ENCODER = "avif:q60:e4|webp:q80:e4";
const CONCURRENCY = Math.max(2, Math.min(4, (os.availableParallelism?.() || 4) - 1));

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
			if (!/\.(md|mdx|ya?ml|js|mjs|json|jsx)$/i.test(file)) continue;
			if (file.endsWith(path.sep + "route-manifest.js")) continue;
			if (file.endsWith(path.sep + "image-sizes.js")) continue;
			if (file.endsWith(path.sep + "image-variants.js")) continue;
			if (file.endsWith(path.sep + "image-sources.js")) continue;
			if (file.endsWith(path.sep + "search-index.json")) continue;
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
let previousEncoder = null;
try {
	const mod = await import("file://" + MANIFEST.replace(/\\/g, "/") + "?t=" + Date.now());
	previous = mod.IMAGE_VARIANTS || {};
	previousEncoder = mod.IMAGE_VARIANTS_ENCODER || null;
} catch {}

const encoderUnchanged = previousEncoder === ENCODER;
mkdirSync(VARIANTS, { recursive: true });
const manifest = {};
const wantedFiles = new Set();
const jobs = [];
let cached = 0;
let skippedSources = 0;

for (const { src, file } of sources) {
	let hash;
	let meta;
	try {
		hash = createHash("sha1").update(readFileSync(file)).digest("hex").slice(0, 12);
		meta = await sharp(file, { failOn: "none" }).metadata();
	} catch {
		skippedSources += 1;
		continue;
	}
	const sourceWidth = meta.width || 0;
	const widthsBase = /^\/static\/(avatars|favicons)\//.test(src) || /\/avatar/i.test(src)
		? SMALL_WIDTHS
		: CONTENT_WIDTHS;
	const widths = widthsBase.filter((w) => w >= 32 && w > 0 && (!sourceWidth || w <= sourceWidth));
	// If the source is narrower than the smallest/largest configured step, keep a
	// variant at its native width so the picture never falls back to a different
	// aspect/size for a small asset.
	if (sourceWidth > 0 && sourceWidth >= 32 && sourceWidth <= widthsBase[widthsBase.length - 1] && !widths.includes(sourceWidth)) {
		widths.push(sourceWidth);
		widths.sort((a, b) => a - b);
	}
	if (!widths.length) continue;

	const prev = previous[src];
	const prevHash = prev && prev.hash === hash;
	const prevWidths = prev && JSON.stringify(prev.widths) === JSON.stringify(widths);
	const entry = { hash, src, widths, avif: {}, webp: {} };
	for (const width of widths) {
		for (const format of FORMATS) {
			const name = hash + "-" + width + "." + format.ext;
			const url = "/static/variants/" + name;
			entry[format.name][String(width)] = url;
			wantedFiles.add(name);
			const out = path.join(VARIANTS, name);
			const prevUrl = prev && prev[format.name] && prev[format.name][String(width)];
			const reusable =
				encoderUnchanged &&
				Boolean(prev) &&
				prevHash &&
				prevWidths &&
				prevUrl === url &&
				existsSync(out);
			if (reusable) {
				cached += 1;
			} else {
				jobs.push({ src, file, out, width, format });
			}
		}
	}
	manifest[src] = entry;
}

let generated = 0;
let bytes = 0;
const failures = [];
let cursor = 0;

async function worker() {
	while (true) {
		const index = cursor;
		cursor += 1;
		if (index >= jobs.length) return;
		const job = jobs[index];
		try {
			const pipeline = sharp(job.file, { failOn: "none" }).resize({
				width: job.width,
				withoutEnlargement: true,
			});
			await job.format.encode(pipeline).toFile(job.out);
			generated += 1;
			bytes += statSync(job.out).size;
		} catch (error) {
			failures.push(job.src + " @ " + job.width + " " + job.format.name + ": " + error.message);
		}
	}
}

if (jobs.length) {
	const workers = Math.min(CONCURRENCY, jobs.length);
	await Promise.all(Array.from({ length: workers }, () => worker()));
}

// Keep the directory tidy: remove variants (either format) that no current source needs.
let removed = 0;
for (const name of readdirSync(VARIANTS)) {
	if (!wantedFiles.has(name)) {
		rmSync(path.join(VARIANTS, name), { force: true });
		removed += 1;
	}
}

const source =
	"// GENERATED by scripts/build-image-variants.mjs — do not edit by hand.\n" +
	"export const IMAGE_VARIANTS_ENCODER = " + JSON.stringify(ENCODER) + ";\n" +
	"export const IMAGE_VARIANTS = " + JSON.stringify(manifest) + ";\n";
let old = "";
try { old = readFileSync(MANIFEST, "utf8"); } catch {}
if (old !== source) writeFileSync(MANIFEST, source);
console.log(
	"image-variants: " + Object.keys(manifest).length + " images, " + generated + " rendered, " +
	cached + " cached, " + removed + " stale removed, " + (bytes / 1024 / 1024).toFixed(2) + " MB written" +
	(skippedSources ? ", " + skippedSources + " unreadable source(s) skipped" : "")
);
if (failures.length) {
	console.error("image-variants failures:\n" + failures.slice(0, 20).join("\n"));
	process.exitCode = 1;
}
