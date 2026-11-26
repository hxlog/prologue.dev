#!/usr/bin/env node
/**
 * Generate the RFC 9727 API catalog and its discovery documents into public/.
 *
 * The site has no origin server: the public "API" is the set of read-only,
 * machine-readable content surfaces (RSS/Atom/JSON feeds, search corpora,
 * sitemap, llms files, version). Keeping them in one OpenAPI description makes
 * the catalog entry useful to an agent instead of a bare link.
 *
 * Runs before next build / next dev in dev, build and export so it works for
 * both Cloudflare and Vercel. Outputs:
 *   public/.well-known/api-catalog
 *   public/.well-known/openapi.json
 *   public/.well-known/api-doc.md
 *
 * Content types and cache policy are set by scripts/build-cf-assets.mjs for
 * Cloudflare; Vercel inherits MIME by extension.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import siteMetadata from "../data/sitemetadata.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(REPO_ROOT, "public", ".well-known");
const BASE = String(siteMetadata.siteUrl || "").replace(/\/+$/, "");

const PATHS = {
  "/rss": { summary: "RSS 2.0 feed", description: "Full-text RSS 2.0 feed for all published posts.", mediaType: "application/rss+xml" },
  "/atomfeed": { summary: "Atom 1.0 feed", description: "Full-text Atom 1.0 feed for all published posts.", mediaType: "application/atom+xml" },
  "/jsonfeed": { summary: "JSON Feed 1.1", description: "Full-text JSON Feed 1.1 document for all published posts.", mediaType: "application/feed+json" },
  "/microblog/rss": { summary: "Microblog RSS 2.0 feed", description: "RSS 2.0 feed for the microblog timeline.", mediaType: "application/rss+xml" },
  "/search-index.json": { summary: "Full-text search corpus", description: "Static JSON corpus used by the browser search dialog.", mediaType: "application/json" },
  "/search-index-lite.json": { summary: "Lite search corpus", description: "Smaller static JSON search corpus loaded first by the browser.", mediaType: "application/json" },
  "/sitemap.xml": { summary: "XML sitemap", description: "All indexable HTML routes and their last-modified dates.", mediaType: "application/xml" },
  "/llms.txt": { summary: "LLM site index", description: "Short llms.txt index of the site content.", mediaType: "text/plain" },
  "/llms-full.txt": { summary: "Full LLM corpus", description: "Full-text llms-full.txt corpus of published content.", mediaType: "text/plain" },
  "/version.json": { summary: "Deployment version", description: "Current deployment version used by the client version guard.", mediaType: "application/json" },
};

function openApi() {
  const paths = {};
  for (const [route, meta] of Object.entries(PATHS)) {
    const operationId = "get" + route.replace(/[^a-zA-Z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : "")).replace(/^get/, "");
    paths[route] = {
      get: {
        summary: meta.summary,
        description: meta.description,
        operationId,
        responses: {
          200: {
            description: meta.summary,
            content: { [meta.mediaType]: { schema: { type: "string" } } },
          },
        },
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Prologue content API",
      version: "1.0.0",
      description: "Read-only, unauthenticated machine surfaces of prologue.dev: feeds, search corpora, sitemap, llms files and deployment version. HTML pages remain the default browser representation; send Accept: text/markdown for the Markdown variant of HTML routes.",
      license: { name: siteMetadata.copyright || "All rights reserved", url: siteMetadata.copyrightUrl || BASE },
    },
    servers: [{ url: BASE }],
    security: [],
    paths,
  };
}

const catalog = {
  linkset: [
    {
      anchor: BASE,
      "service-desc": [{ href: BASE + "/.well-known/openapi.json", type: "application/vnd.oai.openapi+json;version=3.1" }],
      "service-doc": [{ href: BASE + "/.well-known/api-doc.md", type: "text/markdown" }],
      status: [{ href: BASE + "/version.json", type: "application/json" }],
    },
  ],
};

function apiDoc() {
  const lines = [
    "# Prologue content API",
    "",
    "Read-only, unauthenticated machine surfaces of " + BASE + ".",
    "",
    "HTML pages are the default browser representation. Send Accept: text/markdown",
    "on an HTML route to receive the Markdown variant.",
    "",
    "Base URL: " + BASE,
    "",
    "## Endpoints",
    "",
  ];
  for (const [route, meta] of Object.entries(PATHS)) {
    lines.push("- GET " + route + " - " + meta.description + " (" + meta.mediaType + ")");
  }
  lines.push(
    "",
    "## Discovery",
    "",
    "- API catalog: " + BASE + "/.well-known/api-catalog",
    "- OpenAPI 3.1: " + BASE + "/.well-known/openapi.json",
    "- Version / health: " + BASE + "/version.json",
    "",
    "## Policy",
    "",
    "No authentication, no write operations, no request-time rate limits beyond",
    "Cloudflare normal edge protections. Content is licensed under " + (siteMetadata.copyright || "the site license") + ".",
    "",
  );
  return lines.join("\n");
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUT_DIR, "api-catalog"), JSON.stringify(catalog, null, 2) + "\n");
  await fs.writeFile(path.join(OUT_DIR, "openapi.json"), JSON.stringify(openApi(), null, 2) + "\n");
  await fs.writeFile(path.join(OUT_DIR, "api-doc.md"), apiDoc());
  console.log(JSON.stringify({ base: BASE, files: ["api-catalog", "openapi.json", "api-doc.md"], endpoints: Object.keys(PATHS).length }));
}

main().catch((error) => { console.error("[build-api-catalog]", error); process.exit(1); });
