#!/usr/bin/env node
/**
 * Cloudflare Workers Static Assets post-build step.
 *
 * Runs after `next build` with `output: "export"` (NEXT_EXPORT=1) and turns the
 * plain `out/` tree into a deployable Workers Assets directory:
 *
 *   1. writes `out/_headers`   — baseline security headers, the browser/edge
 *      cache policy, MIME types for extensionless files (feeds), and an Early
 *      Hints / preload `Link` header for the build's shared stylesheet;
 *   2. writes `out/_redirects` — currently empty: www -> apex is a Cloudflare
 *      zone Single Redirect rule, because `_redirects` cannot match on host;
 *   3. flattens Next's segmented RSC payload files. Next's static-export client
 *      requests `/<route>/__next.<seg>.<...>.__PAGE__.txt` (dot-joined), while
 *      the exporter writes the same payload as a directory tree
 *      `/<route>/__next.<seg>/<...>/__PAGE__.txt`. Each segmented payload file
 *      is copied to its dot-joined sibling so client-side prefetch/navigation
 *      resolves instead of 404ing. Idempotent: unchanged copies are skipped.
 *
 * Cache policy (single source: out/_headers):
 *   - HTML is never reused by the browser without revalidation
 *     (`public, max-age=0, must-revalidate`) but the edge keeps the deployed
 *     build for a year (`s-maxage=31536000`); the deploy workflow purges the
 *     zone cache after every upload, so a new build is visible immediately and
 *     a client can never pair new HTML with old hashed chunks.
 *   - RSC payloads (`*.txt`) get a 60 s browser TTL — enough to make repeated
 *     client navigations cheap, short enough to bound HTML/RSC version skew —
 *     with the same year-long edge TTL.
 *   - Deployment-visible surfaces (feeds, sitemap, robots, search index,
 *     version.json, service worker) stay must-revalidate in the browser; the
 *     narrow `llms*.txt` rule overrides the RSC TTL back to must-revalidate.
 *   - Content-hashed assets (`/_next/static/*`, `/static/opt|variants|source/*`,
 *     `/og/*`) are immutable.
 *   - Every narrower Cache-Control rule detaches the broader `/*` value first:
 *     matching rules are joined with commas, and a duplicated `max-age` is a
 *     conflicting directive (RFC 9111), which silently breaks caching.
 *
 * Usage:
 *   node scripts/build-cf-assets.mjs            # out/ next to package.json
 *   node scripts/build-cf-assets.mjs <outDir>   # explicit directory
 *
 * No dependencies; safe to run repeatedly.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Resolve the export directory: argv[2] > CF_ASSETS_OUT > "out". */
function resolveOutDir() {
  const arg = process.argv[2];
  if (arg) return path.resolve(process.cwd(), arg);
  if (process.env.CF_ASSETS_OUT) return path.resolve(process.cwd(), process.env.CF_ASSETS_OUT);
  return path.join(REPO_ROOT, "out");
}

/**
 * Stylesheet hrefs referenced by one exported HTML document, in document order.
 * Only `<link rel="stylesheet">` tags count; Next emits exactly one shared CSS
 * chunk for this app, but the extraction does not assume that.
 */
function stylesheetHrefs(html) {
  const hrefs = [];
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    if (!/\brel="stylesheet"/i.test(tag)) continue;
    const href = /\bhref="([^"]+)"/i.exec(tag);
    if (href) hrefs.push(href[1]);
  }
  return hrefs;
}

/**
 * Find the stylesheet(s) linked by EVERY exported HTML page, starting from
 * index.html. Only same-origin paths are eligible (they must exist inside the
 * asset directory for Cloudflare to send them as a preload hint). If the pages
 * disagree, the shared intersection is returned and the mismatch is reported;
 * if there is no shared stylesheet, no Link header is emitted (the caller
 * skips it) rather than preloading a file some pages do not use.
 */
async function extractSharedStylesheets(outDir, htmlFiles) {
  let indexHrefs = null;
  const perPage = new Map();
  for (const rel of htmlFiles) {
    const html = await fs.readFile(path.join(outDir, rel), "utf8");
    const hrefs = stylesheetHrefs(html);
    if (rel === "index.html") indexHrefs = hrefs;
    perPage.set(rel, new Set(hrefs));
  }
  const localIndexHrefs = [...new Set(indexHrefs ?? [])].filter(
    (href) => href.startsWith("/") && !href.startsWith("//"),
  );
  const linkedEverywhere = localIndexHrefs.filter((href) => {
    for (const hrefs of perPage.values()) {
      if (!hrefs.has(href)) return false;
    }
    return true;
  });
  // A preload hint must point at a file that actually shipped; a stylesheet
  // referenced by the HTML but missing from out/ would 404 twice.
  const shared = [];
  const missingFile = [];
  for (const href of linkedEverywhere) {
    try {
      const stat = await fs.stat(path.join(outDir, href.replace(/^\/+/, "")));
      if (stat.isFile()) shared.push(href);
      else missingFile.push(href);
    } catch {
      missingFile.push(href);
    }
  }
  const missingOn = localIndexHrefs.filter((href) => !linkedEverywhere.includes(href));
  return { shared, indexHrefs: localIndexHrefs, missingOn, missingFile, pageCount: perPage.size };
}

/** One `Link` header value listing every shared stylesheet as a style preload. */
function linkHeaderValue(hrefs) {
  return hrefs.map((href) => "<" + href + ">; rel=preload; as=style").join(", ");
}

/**
 * Cloudflare Workers Static Assets `_headers`.
 *
 * Ordering is load-bearing: identical headers from several matching rules are
 * joined with commas, and a duplicated Cache-Control is a conflicting
 * directive (RFC 9111). So the broad `/*` rule comes first and every narrower
 * rule detaches Cache-Control with "! Cache-Control" before setting its own
 * value (Cloudflare docs: detach only removes headers added by rules above it).
 */
function buildHeaders(sharedStylesheets) {
  const noLinkNote =
    sharedStylesheets.length === 0
      ? [
          "# No stylesheet is linked by every exported HTML page, so no Link preload",
          "# hint is emitted (see extractSharedStylesheets in this script).",
        ]
      : [];
  const lines = [
    "# Generated by scripts/build-cf-assets.mjs - do not edit by hand.",
    "# Cloudflare Workers Static Assets _headers (max 100 rules, 2,000 chars/line).",
    "# Rules are applied in file order; narrower Cache-Control rules detach the",
    "# broader value with '! Cache-Control' before setting their own.",
    "",
    "# Baseline security headers inherited by every matching asset response.",
    "# Default cache policy: browsers revalidate (max-age=0) while the edge keeps",
    "# this build for a year (s-maxage=31536000); the deploy workflow purges the",
    "# zone cache after every upload, so a new build is visible immediately. The",
    "# Link header preloads the build's shared stylesheet for Early Hints.",
    ...noLinkNote,
    "/*",
    "  X-Content-Type-Options: nosniff",
    "  Referrer-Policy: strict-origin-when-cross-origin",
    "  Permissions-Policy: camera=(), microphone=(), geolocation=()",
    "  X-Frame-Options: SAMEORIGIN",
    "  Content-Security-Policy: frame-ancestors 'self'",
    "  Content-Signal: ai-train=no, search=yes, ai-input=no",
    "  Cache-Control: public, max-age=0, s-maxage=31536000, must-revalidate",
  ];
  {
    // One Link header carries both the stylesheet preload (Early Hints) and
    // the RFC 9727 api-catalog relation. Two Link lines in _headers would be
    // merged by Cloudflare and the verify script intentionally rejects that.
    const links = [];
    if (sharedStylesheets.length > 0) links.push(linkHeaderValue(sharedStylesheets));
    // RFC 8288 / RFC 9727 agent discovery. Keep all relations in one Link
    // header: Cloudflare joins repeated Link lines into one value anyway and
    // verify-export.mjs rejects duplicate Link lines.
    links.push('</.well-known/api-catalog>; rel="api-catalog"');
    links.push('</.well-known/openapi.json>; rel="service-desc"; type="application/vnd.oai.openapi+json;version=3.1"');
    links.push('</.well-known/api-doc.md>; rel="service-doc"; type="text/markdown"');
    links.push('</llms.txt>; rel="describedby"; type="text/plain"');
    links.push('</version.json>; rel="status"; type="application/json"');
    lines.push("  Link: " + links.join(", "));
  }
  lines.push(
    "",
    "# Next RSC payloads and other plain-text payloads (Next emits *.txt). A 60 s",
    "# browser TTL bounds HTML/RSC version skew; the edge keeps the build a year.",
    "# No stale-while-revalidate: s-maxage already implies proxy-revalidate for the",
    "# shared cache, and a browser SWR window would extend the skew past 60 s.",
    "/*.txt",
    "  Content-Type: text/plain; charset=utf-8",
    "  ! Cache-Control",
    "  Cache-Control: public, max-age=60, s-maxage=31536000",
    "",
    "# Next build output: content-hashed chunk names, safe to cache forever.",
    "/_next/static/*",
    "  ! Cache-Control",
    "  Cache-Control: public, max-age=31536000, immutable",
    "",
    "# Remaining /static assets are NOT content-hashed: 7d + SWR. Broad rule first.",
    "/static/*",
    "  ! Cache-Control",
    "  Cache-Control: public, max-age=604800, stale-while-revalidate=2592000",
    "",
    "# Generated image derivatives (content-hashed file names): immutable.",
    "/static/opt/*",
    "  ! Cache-Control",
    "  Cache-Control: public, max-age=31536000, immutable",
    "/static/variants/*",
    "  ! Cache-Control",
    "  Cache-Control: public, max-age=31536000, immutable",
    "/static/source/*",
    "  ! Cache-Control",
    "  Cache-Control: public, max-age=31536000, immutable",
    "",
    "# Extensionless feed files have no MIME type from their name. Deployment-",
    "# visible surfaces: the browser must revalidate, never serve a stale feed.",
    "/rss",
    "  Content-Type: application/rss+xml; charset=utf-8",
    "  ! Cache-Control",
    "  Cache-Control: public, max-age=0, must-revalidate",
    "/atomfeed",
    "  Content-Type: application/atom+xml; charset=utf-8",
    "  ! Cache-Control",
    "  Cache-Control: public, max-age=0, must-revalidate",
    "/jsonfeed",
    "  Content-Type: application/feed+json; charset=utf-8",
    "  ! Cache-Control",
    "  Cache-Control: public, max-age=0, must-revalidate",
    "/microblog/rss",
    "  Content-Type: application/rss+xml; charset=utf-8",
    "  ! Cache-Control",
    "  Cache-Control: public, max-age=0, must-revalidate",
    "",
    "# Plain-text SEO surfaces: must be revalidated so deployments are visible.",
    "/llms*.txt",
    "  ! Content-Type",
    "  Content-Type: text/plain; charset=utf-8",
    "  ! Cache-Control",
    "  Cache-Control: public, max-age=0, must-revalidate",
    "/sitemap.xml",
    "  Content-Type: application/xml; charset=utf-8",
    "  ! Cache-Control",
    "  Cache-Control: public, max-age=0, must-revalidate",
    "/robots.txt",
    "  ! Content-Type",
    "  Content-Type: text/plain; charset=utf-8",
    "  ! Cache-Control",
    "  Cache-Control: public, max-age=0, must-revalidate",
    "",
    "# Search corpus: rebuilt on every deploy, must be revalidated.",
    "/search-index.json",
    "  Content-Type: application/json; charset=utf-8",
    "  ! Cache-Control",
    "  Cache-Control: public, max-age=0, must-revalidate",
    "/search-index-lite.json",
    "  Content-Type: application/json; charset=utf-8",
    "  ! Cache-Control",
    "  Cache-Control: public, max-age=0, must-revalidate",
    "",
    "# Build version used by the client version guard (reload stale tabs).",
    "/version.json",
    "  Content-Type: application/json; charset=utf-8",
    "  ! Cache-Control",
    "  Cache-Control: public, max-age=0, must-revalidate",
    "",
    "# Service worker + its manifest (emitted by the SW build step when present):",
    "# always revalidated so a new deployment's worker is picked up.",
    "/sw.js",
    "  ! Cache-Control",
    "  Cache-Control: public, max-age=0, must-revalidate",
    "/sw-manifest.json",
    "  Content-Type: application/json; charset=utf-8",
    "  ! Cache-Control",
    "  Cache-Control: public, max-age=0, must-revalidate",
    "",
    "# OG cards: build-generated PNGs with content-addressed file names.",
    "/og/*",
    "  ! Cache-Control",
    "  Cache-Control: public, max-age=31536000, immutable",
    "",
    "# Prebuilt Markdown for Agents variants (scripts/build-markdown.mjs). The",
    "# Worker serves these on Accept: text/markdown; direct requests stay noindex.",
    "/__markdown/*",
    "  Content-Type: text/markdown; charset=utf-8",
    "  X-Robots-Tag: noindex",
    "  ! Cache-Control",
    "  Cache-Control: public, max-age=0, s-maxage=31536000, must-revalidate",
    "",
    "# RFC 9727 API catalog and its discovery documents.",
    "/.well-known/api-catalog",
    "  Content-Type: application/linkset+json",
    "  Access-Control-Allow-Origin: *",
    "  ! Cache-Control",
    "  Cache-Control: public, max-age=0, must-revalidate",
    "/.well-known/openapi.json",
    "  Content-Type: application/vnd.oai.openapi+json;version=3.1",
    "  Access-Control-Allow-Origin: *",
    "  ! Cache-Control",
    "  Cache-Control: public, max-age=0, must-revalidate",
    "/.well-known/api-doc.md",
    "  Content-Type: text/markdown; charset=utf-8",
    "  Access-Control-Allow-Origin: *",
    "  ! Cache-Control",
    "  Cache-Control: public, max-age=0, must-revalidate",
  );
  return lines.join("\n");
}

const REDIRECTS = [
  "# Generated by scripts/build-cf-assets.mjs - do not edit by hand.",
  "# Path-level redirects only. www -> apex is a Cloudflare zone Single Redirect",
  "# rule (host-based redirects are not supported by _redirects).",
].join("\n");

function payloadCopies(relativeFiles) {
  const copies = [];
  for (const rel of relativeFiles) {
    const segments = rel.split("/");
    if (segments[segments.length - 1] !== "__PAGE__.txt") continue;
    const nextIndex = segments.findIndex((segment) => segment.startsWith("__next."));
    if (nextIndex === -1 || nextIndex === segments.length - 1) continue;
    const destinationSegments = [
      ...segments.slice(0, nextIndex),
      segments.slice(nextIndex).join("."),
    ];
    copies.push({ source: rel, destination: destinationSegments.join("/") });
  }
  return copies;
}

async function walkFiles(dir, prefix = "", acc = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const rel = prefix ? prefix + "/" + entry.name : entry.name;
    if (entry.isDirectory()) await walkFiles(path.join(dir, entry.name), rel, acc);
    else if (entry.isFile()) acc.push(rel);
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

async function main() {
  const outDir = resolveOutDir();
  let stat;
  try {
    stat = await fs.stat(outDir);
  } catch {
    throw new Error(
      "export directory not found: " +
        outDir +
        " (run `yarn export` / `NEXT_EXPORT=1 next build` first)",
    );
  }
  if (!stat.isDirectory()) throw new Error("not a directory: " + outDir);

  for (const name of ["index.html", "404.html"]) {
    try {
      await fs.stat(path.join(outDir, name));
    } catch {
      throw new Error(
        "missing " + name + " in " + outDir + " - is this a Next `output: 'export'` build?",
      );
    }
  }

  const files = await walkFiles(outDir);
  const htmlFiles = files.filter((rel) => rel.endsWith(".html"));
  const shared = await extractSharedStylesheets(outDir, htmlFiles);
  if (shared.shared.length === 0) {
    console.warn(
      "[build-cf-assets] no stylesheet is linked by every exported HTML page; " +
        "skipping the Link preload header",
    );
  } else if (shared.missingOn.length > 0) {
    console.warn(
      "[build-cf-assets] index.html stylesheets not linked by every page, " +
        "preloading only the shared ones: " +
        shared.missingOn.join(", "),
    );
  }
  if (shared.missingFile.length > 0) {
    console.warn(
      "[build-cf-assets] shared stylesheet(s) missing from the export, " +
        "not preloading them: " +
        shared.missingFile.join(", "),
    );
  }

  const headers = buildHeaders(shared.shared);
  const headersChanged = await writeIfChanged(path.join(outDir, "_headers"), headers + "\n");
  const redirectsChanged = await writeIfChanged(path.join(outDir, "_redirects"), REDIRECTS + "\n");

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  const copies = payloadCopies(files);
  for (const { source, destination } of copies) {
    const from = path.join(outDir, source);
    const to = path.join(outDir, destination);
    const fromStat = await fs.stat(from);
    let toStat = null;
    try {
      toStat = await fs.stat(to);
    } catch {
      toStat = null;
    }
    if (toStat && toStat.size === fromStat.size && toStat.mtimeMs >= fromStat.mtimeMs) {
      unchanged += 1;
      continue;
    }
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.copyFile(from, to);
    if (toStat) updated += 1;
    else created += 1;
  }

  const finalFiles = await walkFiles(outDir);
  const ruleCount = headers
    .split("\n")
    .filter((line) => line.length > 0 && !line.startsWith("#") && !line.startsWith(" ")).length;
  const summary = {
    outDir,
    files: finalFiles.length,
    headerRules: ruleCount,
    preloadedStylesheets: shared.shared,
    htmlPagesChecked: shared.pageCount,
    stylesheetsMissingFromExport: shared.missingFile,
    headersChanged,
    redirectsChanged,
    payloadCopies: copies.length,
    copiesCreated: created,
    copiesUpdated: updated,
    copiesUnchanged: unchanged,
  };
  console.log("[build-cf-assets] " + JSON.stringify(summary));
  if (finalFiles.length > 20000) {
    throw new Error(
      "asset count " + finalFiles.length + " exceeds the Workers Free plan limit of 20,000 files per version",
    );
  }
}

main().catch((error) => {
  console.error(
    "[build-cf-assets] ERROR: " + (error instanceof Error ? error.message : String(error)),
  );
  process.exitCode = 1;
});