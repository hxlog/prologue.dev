#!/usr/bin/env node
/**
 * Service worker + precache manifest generator for the static export (out/).
 *
 * The site is a fully static Next.js export (NEXT_EXPORT=1) deployed as
 * Cloudflare Workers Static Assets, so there is no server to customise: a
 * service worker is the only place where offline support and a runtime cache
 * policy can live.
 *
 * Inputs:
 *   - every *.html under out/ (one per prerendered route plus 404);
 *   - out/version.json (build version, e.g. a git SHA; timestamp fallback).
 *
 * Outputs:
 *   - out/sw-manifest.json: { version, precache: [urls], generatedAt }
 *   - out/sw.js:            the generated service worker.
 *
 * Precache set: the intersection of the stylesheet / script references across
 * ALL exported pages. Those are the only chunks that are guaranteed to be
 * requested on every route (Next's global CSS + the shared React/turbopack
 * runtime chunks); page-only or route-group-only chunks are left to the
 * runtime cache so the install payload stays bounded. Caps below are runaway
 * guards, not a policy: today's intersection is 1 CSS + 10 JS (~0.7 MB raw).
 *
 * Cache policy in the generated worker (same-origin GET only):
 *   install     precache the shared CSS/JS, one request at a time so a single
 *               failure cannot abort the install; then skipWaiting.
 *   activate    delete caches from older CACHE_VERSIONs; clients.claim.
 *   fetch
 *     /_next/static, /static, /og  immutable -> cache-first.
 *     RSC payloads (pathname *.txt, path contains __next, URL contains
 *     _rsc) -> cache-first + background revalidate.
 *     document navigation -> network-first, cache the response, fall back to
 *     the cache when the network fails (offline).
 *     other GETs -> stale-while-revalidate in the versioned runtime cache.
 *   never cached: cross-origin requests, non-GET requests and /version.json
 *   (the client version guard has to observe the origin; see
 *   src/components/version-guard.js).
 *
 * Usage:
 *   node scripts/build-service-worker.mjs            # out/ next to package.json
 *   node scripts/build-service-worker.mjs <outDir>   # explicit directory
 *
 * The root agent wires this into the export pipeline and into an importable
 * function: buildServiceWorker(outDir) -> Promise<summary>.
 *
 * No dependencies; safe to run repeatedly (unchanged output is not rewritten).
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SW_FILENAME = "sw.js";
const MANIFEST_FILENAME = "sw-manifest.json";

/** Cache-name namespace owned by the generated worker (see template below). */
const CACHE_PREFIX = "prologue-sw";

/**
 * Runaway guards for the precache. The intersection of all pages is small
 * today; these only stop a future build from accidentally precaching a
 * multi-megabyte shared chunk. Oversized entries fall back to the runtime
 * cache, which still works, just not offline-first.
 */
const MAX_PRECACHE_ASSET_BYTES = 1024 * 1024;
const MAX_PRECACHE_TOTAL_BYTES = 2.5 * 1024 * 1024;

/** Root-relative same-origin reference, or null for anything else. */
function normalizeReference(raw) {
  const ref = raw.trim();
  if (!ref.startsWith("/") || ref.startsWith("//")) return null;
  const withoutHash = ref.split("#")[0];
  const pathname = withoutHash.split("?")[0];
  if (pathname.split("/").includes("..") || pathname === "") return null;
  return withoutHash;
}

/**
 * Map of same-origin stylesheet/script URLs referenced by one HTML document.
 * Attribute order and extra attributes are whatever Next emitted, so each tag
 * is matched first and its attributes read second.
 */
function collectReferences(html) {
  const references = new Map();
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    if (!/\brel="stylesheet"/i.test(tag)) continue;
    const href = tag.match(/\bhref="([^"]*)"/i);
    const url = href ? normalizeReference(href[1]) : null;
    if (url) references.set(url, "css");
  }
  for (const match of html.matchAll(/<script\b[^>]*>/gi)) {
    const src = match[0].match(/\bsrc="([^"]*)"/i);
    const url = src ? normalizeReference(src[1]) : null;
    if (url) references.set(url, "js");
  }
  return references;
}

/** Resolve a root-relative URL to its file in the export directory. */
function referenceToDiskPath(outDir, url) {
  return path.join(outDir, url.split("?")[0].slice(1));
}

async function walkFiles(dir, prefix = "", acc = []) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const relative = prefix ? prefix + "/" + entry.name : entry.name;
    if (entry.isDirectory()) await walkFiles(path.join(dir, entry.name), relative, acc);
    else if (entry.isFile()) acc.push(relative);
  }
  return acc;
}

async function writeIfChanged(file, content) {
  let current = null;
  try {
    current = await fs.readFile(file, "utf8");
  } catch {
    current = null;
  }
  if (current === content) return false;
  await fs.writeFile(file, content, "utf8");
  return true;
}

/** Parsed JSON file, or null when it is missing or invalid. */
async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

/** out/version.json version, or a timestamp when the file is absent/invalid. */
async function resolveVersion(outDir) {
  try {
    const raw = await fs.readFile(path.join(outDir, "version.json"), "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed?.version === "string" && parsed.version.trim() !== "") {
      return parsed.version.trim();
    }
  } catch {
    /* fall through to the timestamp */
  }
  return String(Date.now());
}

/**
 * Render the service worker source.
 *
 * The version is the only volatile input: sw.js must change whenever the
 * precache set changes, because a byte-identical worker is not reinstalled by
 * the browser. build-version.mjs runs before every build, so a new deployment
 * always produces a new version and therefore a new worker.
 *
 * The template stays ES2017 (async/await, const/arrow) and deliberately avoids
 * nested template literals, so the generated file is easy to inspect with
 * "node --check".
 */
function renderServiceWorker({ version, precache }) {
  return (
    '/* Generated by scripts/build-service-worker.mjs - do not edit by hand. */\n' +
    "/*\n" +
    " * Offline + cache policy for the prologue.dev static export.\n" +
    " *\n" +
    " * The site is a fully static Next.js export on Cloudflare Workers Static\n" +
    " * Assets: every URL is immutable within one deployment, and the whole cache\n" +
    " * is versioned by CACHE_VERSION (from out/version.json, a new value on every\n" +
    " * build).\n" +
    " *\n" +
    " *   install   precaches the CSS/JS shared by every page, one entry at a time\n" +
    " *             so a single missing chunk cannot abort the install, then\n" +
    " *             skipWaiting.\n" +
    " *   activate  deletes caches from previous CACHE_VERSIONs and claims clients.\n" +
    " *   fetch     same-origin GET only:\n" +
    " *               /_next/static, /static, /og  immutable -> cache-first\n" +
    " *               RSC payloads (*.txt, __next, _rsc) -> cache-first +\n" +
    " *               background revalidate\n" +
    " *               document navigation -> network-first, cache fallback\n" +
    " *               other GETs -> stale-while-revalidate (runtime cache)\n" +
    " *             /version.json is never cached (the version guard must see the\n" +
    " *             network), and cross-origin / non-GET requests are untouched.\n" +
    " */\n" +
    "\n" +
    '"use strict";\n' +
    "\n" +
    "const CACHE_VERSION = " +
    JSON.stringify(version) +
    ";\n" +
    'const CACHE_PREFIX = "' +
    CACHE_PREFIX +
    '";\n' +
    'const PRECACHE_CACHE = CACHE_PREFIX + "-precache-" + CACHE_VERSION;\n' +
    'const RUNTIME_CACHE = CACHE_PREFIX + "-runtime-" + CACHE_VERSION;\n' +
    "\n" +
    "// Intersection of the CSS/JS every exported page references (build output).\n" +
    "const PRECACHE_URLS = " +
    JSON.stringify(precache, null, 2) +
    ";\n" +
    "\n" +
    'const IMMUTABLE_PREFIXES = ["/_next/static/", "/static/", "/og/"];\n' +
    'const NEVER_CACHE_PATH = "/version.json";\n' +
    "\n" +
    "function isImmutablePath(pathname) {\n" +
    "  return IMMUTABLE_PREFIXES.some(function (prefix) {\n" +
    "    return pathname.startsWith(prefix);\n" +
    "  });\n" +
    "}\n" +
    "\n" +
    "// Next's static export answers client navigation with RSC .txt payloads;\n" +
    "// they are per-route content, so they are cached but revalidated in the\n" +
    "// background (unlike the content-hashed build output above).\n" +
    "function isNavigationPayload(url) {\n" +
    '  if (url.pathname.endsWith(".txt")) return true;\n' +
    '  if (url.pathname.includes("__next")) return true;\n' +
    '  return url.href.includes("_rsc");\n' +
    "}\n" +
    "\n" +
    "function isDocumentNavigation(request) {\n" +
    '  if (request.mode === "navigate") return true;\n' +
    '  const accept = request.headers.get("accept");\n' +
    '  return typeof accept === "string" && accept.includes("text/html");\n' +
    "}\n" +
    "\n" +
    "async function readCached(request) {\n" +
    "  const runtime = await caches.open(RUNTIME_CACHE);\n" +
    "  const fromRuntime = await runtime.match(request);\n" +
    "  if (fromRuntime) return fromRuntime;\n" +
    "  const precache = await caches.open(PRECACHE_CACHE);\n" +
    "  return precache.match(request);\n" +
    "}\n" +
    "\n" +
    "// Store only complete, same-origin responses; keep the response itself\n" +
    "// readable by the caller (clone before put).\n" +
    "async function storeInRuntime(request, response) {\n" +
    '  if (!response || !response.ok || response.type !== "basic") return;\n' +
    "  const cache = await caches.open(RUNTIME_CACHE);\n" +
    "  await cache.put(request, response);\n" +
    "}\n" +
    "\n" +
    "async function fetchAndCache(request) {\n" +
    "  const response = await fetch(request);\n" +
    '  if (response && response.ok && response.type === "basic") {\n' +
    "    const copy = response.clone();\n" +
    "    await storeInRuntime(request, copy);\n" +
    "  }\n" +
    "  return response;\n" +
    "}\n" +
    "\n" +
    "// Background work must not keep the response waiting, and a failure there\n" +
    "// must never affect the page (offline revalidation simply retries later).\n" +
    "function runInBackground(event, task) {\n" +
    "  const settled = task.catch(function () {});\n" +
    "  try {\n" +
    "    event.waitUntil(settled);\n" +
    "  } catch (error) {\n" +
    "    /* The event no longer accepts work; the response is unaffected. */\n" +
    "  }\n" +
    "}\n" +
    "\n" +
    "// cache-first; revalidate=true turns it into stale-while-revalidate.\n" +
    "async function cacheFirst(event, request, revalidate) {\n" +
    "  const cached = await readCached(request);\n" +
    "  if (cached) {\n" +
    "    if (revalidate) runInBackground(event, fetchAndCache(request));\n" +
    "    return cached;\n" +
    "  }\n" +
    "  return fetchAndCache(request);\n" +
    "}\n" +
    "\n" +
    "// network-first; the cache is the offline fallback.\n" +
    "async function networkFirst(event, request) {\n" +
    "  try {\n" +
    "    const response = await fetch(request);\n" +
    '    if (response && response.ok && response.type === "basic") {\n' +
    "      const copy = response.clone();\n" +
    "      runInBackground(\n" +
    "        event,\n" +
    "        storeInRuntime(request, copy).catch(function () {}),\n" +
    "      );\n" +
    "    }\n" +
    "    return response;\n" +
    "  } catch (error) {\n" +
    "    const cached = await readCached(request);\n" +
    "    if (cached) return cached;\n" +
    "    throw error;\n" +
    "  }\n" +
    "}\n" +
    "\n" +
    'self.addEventListener("install", function (event) {\n' +
    "  event.waitUntil(\n" +
    "    (async function () {\n" +
    "      const cache = await caches.open(PRECACHE_CACHE);\n" +
    "      for (const url of PRECACHE_URLS) {\n" +
    "        try {\n" +
    '          await cache.add(new Request(url, { cache: "reload" }));\n' +
    "        } catch (error) {\n" +
    "          /* One failed asset must not block the rest of the precache. */\n" +
    "        }\n" +
    "      }\n" +
    "      await self.skipWaiting();\n" +
    "    })(),\n" +
    "  );\n" +
    "});\n" +
    "\n" +
    'self.addEventListener("activate", function (event) {\n' +
    "  event.waitUntil(\n" +
    "    (async function () {\n" +
    "      const keep = new Set([PRECACHE_CACHE, RUNTIME_CACHE]);\n" +
    "      const keys = await caches.keys();\n" +
    "      await Promise.all(\n" +
    "        keys\n" +
    '          .filter(function (key) { return !keep.has(key) && key.startsWith(CACHE_PREFIX + "-"); })\n' +
    "          .map(function (key) { return caches.delete(key); }),\n" +
    "      );\n" +
    "      await self.clients.claim();\n" +
    "    })(),\n" +
    "  );\n" +
    "});\n" +
    "\n" +
    'self.addEventListener("fetch", function (event) {\n' +
    "  const request = event.request;\n" +
    '  if (request.method !== "GET") return;\n' +
    "\n" +
    "  let url;\n" +
    "  try {\n" +
    "    url = new URL(request.url);\n" +
    "  } catch (error) {\n" +
    "    return;\n" +
    "  }\n" +
    "\n" +
    "  if (url.origin !== self.location.origin) return; // cross-origin: browser default\n" +
    "  if (url.pathname === NEVER_CACHE_PATH) return; // version guard: network only\n" +
    "\n" +
    "  if (isDocumentNavigation(request)) {\n" +
    "    event.respondWith(networkFirst(event, request));\n" +
    "    return;\n" +
    "  }\n" +
    "\n" +
    "  if (isImmutablePath(url.pathname)) {\n" +
    "    event.respondWith(cacheFirst(event, request, false));\n" +
    "    return;\n" +
    "  }\n" +
    "\n" +
    "  if (isNavigationPayload(url)) {\n" +
    "    event.respondWith(cacheFirst(event, request, true));\n" +
    "    return;\n" +
    "  }\n" +
    "\n" +
    "  // Other same-origin GETs (feeds, JSON corpora, non-prefixed assets): serve\n" +
    "  // the cache immediately and refresh it in the background.\n" +
    "  event.respondWith(cacheFirst(event, request, true));\n" +
    "});\n"
  );
}

/**
 * Generate out/sw.js and out/sw-manifest.json for an exported site.
 *
 * @param {string} [outDir] Export directory; defaults to <repo>/out.
 * @returns {Promise<object>} Summary: version, precache count/bytes, file status.
 */
export async function buildServiceWorker(outDir) {
  const resolvedOutDir = path.resolve(outDir ?? path.join(REPO_ROOT, "out"));

  const stat = await fs.stat(resolvedOutDir).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    throw new Error(
      "export directory not found: " + resolvedOutDir + " (run yarn export first)",
    );
  }

  const files = await walkFiles(resolvedOutDir);
  const htmlFiles = files
    .filter((file) => file.toLowerCase().endsWith(".html"))
    .sort();
  if (htmlFiles.length === 0) {
    throw new Error(
      "no HTML files in " + resolvedOutDir + " - is this a Next static export?",
    );
  }

  // Intersection of asset references across every exported page.
  const warnings = [];
  let common = null;
  for (const file of htmlFiles) {
    const html = await fs.readFile(path.join(resolvedOutDir, file), "utf8");
    const references = collectReferences(html);
    if (common === null) {
      common = references;
    } else {
      for (const url of common.keys()) {
        if (!references.has(url)) common.delete(url);
      }
    }
  }

  const candidates = [];
  for (const [url, kind] of common) {
    const assetStat = await fs.stat(referenceToDiskPath(resolvedOutDir, url)).catch(() => null);
    if (!assetStat || !assetStat.isFile()) {
      warnings.push("every page references a missing file, skipped: " + url);
      continue;
    }
    candidates.push({ url, kind, bytes: assetStat.size });
  }
  // Deterministic order: CSS first (render-blocking / critical), then JS, each
  // sorted so a rebuild with the same build output yields byte-identical sw.js.
  candidates.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "css" ? -1 : 1;
    return a.url < b.url ? -1 : a.url > b.url ? 1 : 0;
  });

  const precache = [];
  let precacheBytes = 0;
  for (const candidate of candidates) {
    if (candidate.bytes > MAX_PRECACHE_ASSET_BYTES) {
      warnings.push(
        "shared asset too large to precache (" + candidate.bytes + " B): " + candidate.url,
      );
      continue;
    }
    if (precacheBytes + candidate.bytes > MAX_PRECACHE_TOTAL_BYTES) {
      warnings.push("shared asset over the precache budget: " + candidate.url);
      continue;
    }
    precache.push(candidate.url);
    precacheBytes += candidate.bytes;
  }
  if (precache.length === 0) {
    warnings.push("no shared CSS/JS found across pages; the precache is empty");
  }

  const version = await resolveVersion(resolvedOutDir);
  const swPath = path.join(resolvedOutDir, SW_FILENAME);
  const manifestPath = path.join(resolvedOutDir, MANIFEST_FILENAME);

  // Keep generatedAt stable while version + precache are unchanged, so a
  // rebuild from identical build output is byte-identical (the same rule the
  // feeds follow: identical content must produce identical bytes).
  const previous = await readJson(manifestPath);
  const generatedAt =
    previous &&
    previous.version === version &&
    typeof previous.generatedAt === "string" &&
    Array.isArray(previous.precache) &&
    previous.precache.length === precache.length &&
    previous.precache.every((url, index) => url === precache[index])
      ? previous.generatedAt
      : new Date().toISOString();
  const manifest = { version, precache, generatedAt };
  const swSource = renderServiceWorker({ version, precache });

  const swChanged = await writeIfChanged(swPath, swSource);
  const manifestChanged = await writeIfChanged(
    manifestPath,
    JSON.stringify(manifest, null, 2) + "\n",
  );

  return {
    outDir: resolvedOutDir,
    htmlFiles: htmlFiles.length,
    version,
    precacheCount: precache.length,
    precacheBytes,
    swBytes: Buffer.byteLength(swSource),
    swChanged,
    manifestChanged,
    warnings,
  };
}

/** CLI out/ directory: argv[2] > SW_OUT_DIR > CF_ASSETS_OUT > <repo>/out. */
function resolveOutDir() {
  const arg = process.argv[2];
  if (arg) return path.resolve(process.cwd(), arg);
  const envDir = process.env.SW_OUT_DIR || process.env.CF_ASSETS_OUT;
  if (envDir) return path.resolve(process.cwd(), envDir);
  return path.join(REPO_ROOT, "out");
}

async function main() {
  const summary = await buildServiceWorker(resolveOutDir());
  console.log("[build-service-worker] " + JSON.stringify(summary));
}

const isDirectRun =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  main().catch((error) => {
    console.error(
      "[build-service-worker] ERROR: " +
        (error instanceof Error ? error.message : String(error)),
    );
    process.exitCode = 1;
  });
}
