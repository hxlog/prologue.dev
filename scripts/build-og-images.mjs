#!/usr/bin/env node
/**
 * Pre-render every Open Graph card to a static PNG.
 *
 * The site's `/og` route used to draw cards at request time from a query string
 * (`/og?title=…&date=…&tags=…`). Under `output: "export"` that cannot work: a
 * static host serves one file per path and a route handler cannot read a
 * query. So each card is rendered once here, into `public/og/<key>.png`, and
 * every page/feed/JSON-LD URL points at that file instead (see
 * `src/lib/og/keys.js` for the key rules).
 *
 * Keys (see keys.js):
 *   default             the site-wide fallback card
 *   post-<slug>         one per post that has no cover image (covers win)
 *   tag-<english-slug>  one per tag in the taxonomy
 *   page-<name>         one per markdown page + the fixed app pages
 *                        (microblog/links/ui)
 *
 * Usage:
 *   node scripts/build-og-images.mjs                  # render all missing/stale
 *   node scripts/build-og-images.mjs --force          # re-render everything
 *   node scripts/build-og-images.mjs --keys=default,post-2025-summary,tag-AI
 *   node scripts/build-og-images.mjs --limit=3        # first 3 cards only
 *   node scripts/build-og-images.mjs --concurrency=4
 *   node scripts/build-og-images.mjs --no-prune       # keep stale PNGs
 *   node scripts/build-og-images.mjs --dry-run
 *
 * Idempotent: a card is skipped when its input hash (version + title/date/read/
 * tags/kind) matches `data/og-manifest.js` and its PNG exists. A full run also
 * prunes `public/og/*.png` files whose key is no longer in the manifest.
 *
 * `data/og-manifest.js` is a build artifact (not imported by the app); it is
 * what makes the per-card skip decision possible and records what was rendered.
 *
 * The card renderer lives in `src/lib/og/render.js` as JSX. Plain Node cannot
 * import JSX, so this script transpiles that single file with Next's bundled
 * SWC (the same compiler `next build` uses) into a sibling temporary module,
 * imports it, and deletes it in a finally block.
 */

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import siteMetadata from "../data/sitemetadata.js";
import tagLabels from "../data/tagLabels.js";
import { readingTimeLabel } from "../src/lib/date.js";
import { getPages, getPosts } from "../src/lib/content/standalone.js";
import {
  OG_DEFAULT_KEY,
  OG_IMAGE_HEIGHT,
  OG_IMAGE_VERSION,
  OG_IMAGE_WIDTH,
  ogKeyForPage,
  ogKeyForPost,
  ogKeyForTag,
} from "../src/lib/og/keys.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// The content loader resolves data/content from process.cwd(); the script must
// behave the same whether invoked from the repo root or a parent directory.
process.chdir(ROOT);

const RENDER_SOURCE = path.join(ROOT, "src", "lib", "og", "render.js");
const PUBLIC_OG_DIR = path.join(ROOT, "public", "og");
const MANIFEST_PATH = path.join(ROOT, "data", "og-manifest.js");
const MANIFEST_REL = "data/og-manifest.js";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const options = {
    keys: null, // null = every card
    limit: null,
    concurrency: 4,
    force: false,
    prune: true,
    dryRun: false,
  };
  for (const arg of argv) {
    if (arg === "--force") options.force = true;
    else if (arg === "--no-prune") options.prune = false;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/build-og-images.mjs [--force] [--keys=a,b] [--limit=N] [--concurrency=N] [--no-prune] [--dry-run]`);
      process.exit(0);
    } else if (arg.startsWith("--keys=")) {
      options.keys = arg
        .slice("--keys=".length)
        .split(",")
        .map((key) => key.trim())
        .filter(Boolean);
    } else if (arg.startsWith("--limit=")) {
      options.limit = Number.parseInt(arg.slice("--limit=".length), 10);
    } else if (arg.startsWith("--concurrency=")) {
      options.concurrency = Math.max(
        1,
        Number.parseInt(arg.slice("--concurrency=".length), 10) || 1
      );
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (options.limit !== null && (!Number.isInteger(options.limit) || options.limit <= 0)) {
    throw new Error("--limit must be a positive integer");
  }
  return options;
}

// ---------------------------------------------------------------------------
// Card inputs
// ---------------------------------------------------------------------------

/**
 * The full set of cards the site references. Derived from the same content and
 * metadata the runtime uses, so the keys match what `ogKeyForPath()` derives
 * from each page path:
 *
 *   - every post without a cover image (a cover image wins in metadata/feeds),
 *   - every tag in the taxonomy (label on the card, English slug in the key),
 *   - every markdown page (about, …),
 *   - the fixed app pages whose metadata calls defaultOgImage: microblog,
 *     links, ui,
 *   - the site-wide default card (home fallback / unknown paths).
 */
function collectCards() {
  const cards = [];
  const add = (card) => {
    if (cards.some((existing) => existing.key === card.key)) {
      throw new Error(`[og] duplicate card key: ${card.key}`);
    }
    cards.push(card);
  };

  const posts = getPosts().filter((post) => post.draft !== true);
  for (const post of posts) {
    if (String(post.image || "").trim()) continue; // cover image wins
    add({
      key: ogKeyForPost(post.slugAsParams),
      kind: "post",
      title: post.title,
      date: post.publishDate,
      read: readingTimeLabel(post.readingTime),
      tags: post.tags || [],
    });
  }

  const tagCounts = {};
  for (const post of posts) {
    for (const tag of post.tags || []) tagCounts[tag] = (tagCounts[tag] || 0) + 1;
  }
  for (const tag of Object.keys(tagCounts).sort()) {
    add({
      key: ogKeyForTag(tag),
      kind: "page",
      title: tagLabels[tag] || tag,
    });
  }

  for (const page of getPages()) {
    add({
      key: ogKeyForPage(page.slugAsParams),
      kind: "page",
      title: page.title,
    });
  }

  const fixedPages = [
    ["microblog", siteMetadata.pages.microblog.title],
    ["links", siteMetadata.pages.links.heading],
    ["ui", siteMetadata.pages.ui.heading],
  ];
  for (const [name, title] of fixedPages) {
    add({ key: ogKeyForPage(name), kind: "page", title });
  }

  add({ key: OG_DEFAULT_KEY, kind: "page", title: siteMetadata.siteName });

  return cards.sort((a, b) => a.key.localeCompare(b.key));
}

// ---------------------------------------------------------------------------
// render.js — transpile JSX with Next's SWC into an importable sibling module
// ---------------------------------------------------------------------------

const require = createRequire(import.meta.url);

async function loadRenderer() {
  const swc = require("next/dist/build/swc");
  const source = await readFile(RENDER_SOURCE, "utf8");
  const { code } = swc.transformSync(source, {
    filename: RENDER_SOURCE,
    jsc: {
      parser: { syntax: "ecmascript", jsx: true },
      transform: { react: { runtime: "automatic", development: false } },
      target: "es2022",
    },
    module: { type: "es6" },
  });

  // Keep the generated module next to render.js so its relative imports
  // ("./keys.js", "../date.js", …) resolve; delete it once imported.
  const tempFile = path.join(
    path.dirname(RENDER_SOURCE),
    `.render.generated-${process.pid}.mjs`
  );
  await writeFile(tempFile, code, "utf8");
  try {
    const mod = await import(`${pathToFileURL(tempFile).href}?t=${Date.now()}`);
    return mod;
  } finally {
    await unlink(tempFile).catch(() => {});
  }
}

async function loadImageResponse() {
  // Plain Node ESM cannot resolve the extensionless `next/og` subpath; `next/og.js`
  // is the physical file Next's package root ships and it works in Node.
  const mod = await import("next/og.js");
  const ImageResponse =
    mod.ImageResponse ?? mod.default?.ImageResponse ?? mod.default;
  if (typeof ImageResponse !== "function") {
    throw new Error("[og] could not load ImageResponse from next/og.js");
  }
  return ImageResponse;
}

// ---------------------------------------------------------------------------
// Manifest + PNG helpers
// ---------------------------------------------------------------------------

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** PNG dimensions from the IHDR chunk (no image library needed). */
function readPngSize(buffer) {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_MAGIC)) {
    throw new Error("[og] not a PNG file");
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function cardHash(card) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        version: OG_IMAGE_VERSION,
        kind: card.kind,
        title: card.title,
        date: card.date || "",
        read: card.read || "",
        tags: card.tags || [],
      })
    )
    .digest("hex")
    .slice(0, 16);
}

async function loadOldManifest() {
  try {
    const manifest = await import(`${pathToFileURL(MANIFEST_PATH).href}?t=${Date.now()}`);
    const entries = Array.isArray(manifest.OG_IMAGES) ? manifest.OG_IMAGES : [];
    return new Map(entries.map((entry) => [entry.key, entry]));
  } catch {
    return new Map();
  }
}

function renderManifest(entries) {
  const sorted = [...entries].sort((a, b) => a.key.localeCompare(b.key));
  const lines = [
    "/**",
    " * Generated by `scripts/build-og-images.mjs` — do not edit by hand.",
    " *",
    " * Build artifact: the app derives OG URLs from page paths",
    " * (`src/lib/og/keys.js`), so nothing imports this at runtime. The script",
    " * reads it to skip cards whose input did not change.",
    " */",
    "",
    `export const OG_IMAGE_VERSION = ${JSON.stringify(OG_IMAGE_VERSION)};`,
    `export const OG_IMAGE_DIR = "/og";`,
    `export const OG_IMAGE_WIDTH = ${OG_IMAGE_WIDTH};`,
    `export const OG_IMAGE_HEIGHT = ${OG_IMAGE_HEIGHT};`,
    `export const OG_IMAGE_COUNT = ${sorted.length};`,
    "",
    "export const OG_IMAGE_KEYS = [",
    ...sorted.map((entry) => `  ${JSON.stringify(entry.key)},`),
    "];",
    "",
    "export const OG_IMAGES = [",
    ...sorted.map(
      (entry) =>
        `  { key: ${JSON.stringify(entry.key)}, kind: ${JSON.stringify(entry.kind)}, title: ${JSON.stringify(entry.title)}, hash: ${JSON.stringify(entry.hash)} },`
    ),
    "];",
    "",
  ];
  return lines.join("\n");
}

async function fileExists(file) {
  try {
    const info = await stat(file);
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

async function writeFileAtomic(file, data) {
  const temp = `${file}.tmp-${process.pid}`;
  await writeFile(temp, data);
  await rename(temp, file);
}

async function withConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex++;
        results[index] = await worker(items[index], index);
      }
    }
  );
  await Promise.all(runners);
  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const allCards = collectCards();
  const allKeys = allCards.map((card) => card.key);

  let selected = allCards;
  const isFullRun = !options.keys && options.limit === null;

  if (options.keys) {
    const known = new Set(allKeys);
    const unknown = options.keys.filter((key) => !known.has(key));
    if (unknown.length > 0) {
      throw new Error(
        `[og] unknown key(s): ${unknown.join(", ")}\n` +
          `Known keys (first 20): ${allKeys.slice(0, 20).join(", ")}…\n` +
          `Run without --keys for the full list (${allCards.length} cards).`
      );
    }
    const wanted = new Set(options.keys);
    selected = allCards.filter((card) => wanted.has(card.key));
  } else if (options.limit !== null) {
    selected = allCards.slice(0, options.limit);
  }

  const renderer = await loadRenderer();
  const ImageResponse = await loadImageResponse();

  // Pre-check the committed font subset: cards whose drawn text is not covered
  // fall back to a per-card Google Fonts fetch, which is slow and needs network.
  const glyphs = renderer.localGlyphSet();
  const remoteCards = [];
  if (glyphs) {
    for (const card of selected) {
      const text = renderer.cardText(card);
      const missing = [...text].some((char) => !glyphs.has(char.codePointAt(0)));
      if (missing) remoteCards.push(card.key);
    }
  }
  if (!glyphs) {
    console.warn(
      "[og] WARNING: assets/og fonts are missing — every card will use the " +
        "per-card Google Fonts fallback. Run `node scripts/build-og-font.mjs`."
    );
  } else if (remoteCards.length > 0) {
    console.warn(
      `[og] WARNING: ${remoteCards.length} card(s) use characters the committed subset lacks; ` +
        "they fall back to Google Fonts. Run `node scripts/build-og-font.mjs` to refresh assets/og.\n" +
        `  affected: ${remoteCards.slice(0, 8).join(", ")}${remoteCards.length > 8 ? " …" : ""}`
    );
  }

  await mkdir(PUBLIC_OG_DIR, { recursive: true });
  const oldEntries = await loadOldManifest();

  const generated = [];
  const skipped = [];
  const remoteFontCards = [];

  await withConcurrency(selected, options.concurrency, async (card) => {
    const hash = cardHash(card);
    const file = path.join(ROOT, "public", "og", ...card.key.split("/")) + ".png";
    const previous = oldEntries.get(card.key);

    if (
      !options.force &&
      previous &&
      previous.hash === hash &&
      (await fileExists(file))
    ) {
      skipped.push(card.key);
      return;
    }

    const { png, meta } = await renderer.renderOgCard(card, ImageResponse);
    const { width, height } = readPngSize(png);
    if (width !== OG_IMAGE_WIDTH || height !== OG_IMAGE_HEIGHT) {
      throw new Error(
        `[og] ${card.key}: rendered ${width}×${height}, expected ` +
          `${OG_IMAGE_WIDTH}×${OG_IMAGE_HEIGHT}`
      );
    }

    if (meta.fontSource === "remote") remoteFontCards.push(card.key);

    if (options.dryRun) {
      console.log(`[og] would write ${card.key}.png (${png.length} bytes)`);
    } else {
      await writeFileAtomic(file, png);
    }
    generated.push(card.key);
  });

  // The manifest always describes every expected card on a full run. On a
  // --keys/--limit run, keep the previous entries for the cards not touched so
  // the file stays a superset of what exists.
  let entries;
  if (isFullRun) {
    entries = allCards.map((card) => ({
      key: card.key,
      kind: card.kind,
      title: card.title,
      hash: cardHash(card),
    }));
  } else {
    entries = [...oldEntries.values()];
    const byKey = new Map(entries.map((entry) => [entry.key, entry]));
    for (const card of selected) {
      byKey.set(card.key, {
        key: card.key,
        kind: card.kind,
        title: card.title,
        hash: cardHash(card),
      });
    }
    entries = [...byKey.values()];
  }

  let pruned = [];
  if (isFullRun && options.prune && !options.dryRun) {
    const allowed = new Set(allCards.map((card) => `${card.key}.png`));
    const files = await readdir(PUBLIC_OG_DIR).catch(() => []);
    for (const name of files) {
      if (!name.endsWith(".png") || allowed.has(name)) continue;
      await unlink(path.join(PUBLIC_OG_DIR, name)).catch(() => {});
      pruned.push(name);
    }
  }

  if (!options.dryRun) {
    await writeFileAtomic(MANIFEST_PATH, renderManifest(entries));
  }

  const summary = [];
  summary.push(
    `[og] ${generated.length} rendered, ${skipped.length} skipped, ` +
      `${entries.length}/${allCards.length} cards in ${MANIFEST_REL}`
  );
  if (pruned.length > 0) summary.push(`[og] pruned ${pruned.length}: ${pruned.join(", ")}`);
  if (remoteFontCards.length > 0) {
    summary.push(
      `[og] WARNING: ${remoteFontCards.length} card(s) used the Google Fonts fallback: ` +
        remoteFontCards.slice(0, 8).join(", ") +
        (remoteFontCards.length > 8 ? " …" : "")
    );
  }
  if (options.dryRun) summary.push("[og] dry run — nothing written");
  console.log(summary.join("\n"));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
