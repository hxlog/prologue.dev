#!/usr/bin/env node
/**
 * Build Markdown for Agents variants from the exported HTML.
 *
 * The site is a fully static export. Cloudflare's native Markdown for Agents
 * (content_converter) requires a paid Pro+ zone, so on the Free plan the
 * content-negotiation Worker (worker/index.js) serves these prebuilt variants
 * when a request carries "Accept: text/markdown".
 *
 * One Markdown file per exported HTML page:
 *   out/index.html          -> out/__markdown/index.md
 *   out/blog.html           -> out/__markdown/blog.md
 *   out/blog/<slug>.html    -> out/__markdown/blog/<slug>.md
 *
 * Each file starts with YAML frontmatter extracted from the page metadata, has
 * the non-content chrome (nav/footer/aside/buttons) removed, and appends the
 * page's JSON-LD as one fenced JSON block, mirroring Cloudflare's converter.
 *
 * Usage: node scripts/build-markdown.mjs [outDir]
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.resolve(process.argv[2] || path.join(REPO_ROOT, "out"));
const MD_DIR = path.join(OUT_DIR, "__markdown");

/** Walk a directory recursively and return POSIX-relative file paths. */
async function walk(dir, prefix = "") {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const rel = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path.join(dir, entry.name), rel)));
    else files.push(rel);
  }
  return files;
}

/** Map an exported HTML file to its public URL path (no trailing slash). */
function urlPathFor(rel) {
  if (rel === "index.html") return "/";
  if (rel.endsWith("/index.html")) return "/" + rel.slice(0, -"/index.html".length);
  return "/" + rel.slice(0, -".html".length);
}

/** Map a public URL path to the Markdown asset path served by the Worker. */
function markdownRelPath(urlPath) {
  if (urlPath === "/") return "index.md";
  return urlPath.replace(/^\/+/, "") + ".md";
}

/** Pick the first non-empty <meta> value. */
function meta(document, selectors) {
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    const value = el?.getAttribute("content") || el?.getAttribute("href");
    if (value) return value.trim();
  }
  return "";
}

function plainText(el) {
  return (el?.textContent || "").replace(/\s+/g, " ").trim();
}

function yamlString(value) {
  return JSON.stringify(value);
}

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
  emDelimiter: "*",
  strongDelimiter: "**",
  linkStyle: "inlined",
  hr: "---",
});
turndown.use(gfm);
turndown.remove(["script", "style", "noscript", "iframe", "canvas", "svg", "form", "button", "input", "select", "textarea"]);

const REMOVE_SELECTORS = [
  "nav",
  "footer",
  "aside",
  "[role='navigation']",
  "[role='banner']",
  "[role='contentinfo']",
  ".skip-link",
  ".copy-field",
  ".toc-panel",
  ".search-dialog",
  ".nav-skeleton",
  ".tag-header-skeleton",
  ".tag-content-skeleton",
  "[data-nav-skeleton]",
  "[data-tag-header-skeleton]",
  "[data-tag-content-skeleton]",
  "[hidden]",
];

function toMarkdown(html, rel) {
  const { document } = parseHTML(html);
  const urlPath = urlPathFor(rel);

  const title =
    meta(document, ['meta[name="title"]', 'meta[property="og:title"]']) ||
    plainText(document.querySelector("main h1")) ||
    plainText(document.querySelector("title")) ||
    urlPath;
  const description = meta(document, [
    'meta[name="description"]',
    'meta[property="og:description"]',
  ]);
  const image = meta(document, ['meta[property="og:image"]']);

  const jsonLd = [
    ...document.querySelectorAll('script[type="application/ld+json"]'),
  ]
    .map((el) => (el.textContent || "").trim())
    .filter(Boolean);

  const root = document.querySelector("main") || document.querySelector("article") || document.body;
  if (!root) return "";

  // Remove page chrome inside <main> (archive sidebars, nested nav, etc.).
  for (const selector of REMOVE_SELECTORS) {
    for (const el of root.querySelectorAll(selector)) el.remove();
  }
  // Remove trailing interactive chrome that is not useful in Markdown.
  for (const el of root.querySelectorAll("button, input, select, textarea, .btn")) el.remove();

  let body = turndown.turndown(root.innerHTML || "");
  body = body
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const frontmatter = ["---"];
  frontmatter.push("title: " + yamlString(title));
  if (description) frontmatter.push("description: " + yamlString(description));
  if (image) frontmatter.push("image: " + yamlString(image));
  frontmatter.push("---");

  const parts = [frontmatter.join("\n"), body];
  if (jsonLd.length > 0) {
    parts.push("\u0060\u0060\u0060json\n" + jsonLd.join("\n") + "\n\u0060\u0060\u0060");
  }
  return parts.filter(Boolean).join("\n\n") + "\n";
}

async function main() {
  try {
    await fs.access(OUT_DIR);
  } catch {
    console.error("[build-markdown] out directory not found: " + OUT_DIR);
    process.exit(1);
  }

  await fs.rm(MD_DIR, { recursive: true, force: true });
  await fs.mkdir(MD_DIR, { recursive: true });

  const files = (await walk(OUT_DIR)).filter((rel) => rel.endsWith(".html"));
  const written = [];
  for (const rel of files) {
    const html = await fs.readFile(path.join(OUT_DIR, rel), "utf8");
    const markdown = toMarkdown(html, rel);
    if (!markdown.trim()) continue;
    const outRel = markdownRelPath(urlPathFor(rel));
    const outFile = path.join(MD_DIR, outRel);
    await fs.mkdir(path.dirname(outFile), { recursive: true });
    await fs.writeFile(outFile, markdown);
    written.push({ from: rel, to: outRel, bytes: Buffer.byteLength(markdown) });
  }

  console.log(
    JSON.stringify(
      {
        outDir: OUT_DIR,
        htmlFiles: files.length,
        markdownFiles: written.length,
        totalBytes: written.reduce((sum, item) => sum + item.bytes, 0),
        sample: written.slice(0, 5),
      },
      null,
      1,
    ),
  );
}

main().catch((error) => {
  console.error("[build-markdown]", error);
  process.exit(1);
});
