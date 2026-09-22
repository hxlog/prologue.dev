/**
 * Reads data/content/** and produces the document shape Contentlayer2 emitted.
 *
 * Frontmatter, readingTime and headings are computed eagerly and are cheap.
 * body.html needs Shiki and is computed LAZILY on first request, then cached --
 * so a dev session that opens three posts compiles three, not sixty-three, and
 * the homepage never pays for Shiki at all.
 *
 * body.html is therefore ASYNC. Reading it synchronously throws with a message
 * naming the fix, rather than silently returning "". Callers that need it await
 * getAllPostsWithBody() (feeds) or getBodyHtml(page).
 *
 * NO `import "server-only"` HERE. The guard lives in ./index.js, the module the
 * site imports. Putting it here would make this file unimportable from a plain
 * `node scripts/...` run, which is how every check in this repo works.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import yaml from "yaml";
import readingTime from "reading-time";

import { renderMarkdown, stripFrontmatter } from "./pipeline.js";
import { extractHeadings } from "./slug.js";

const CONTENT_DIR = path.join(process.cwd(), "data", "content");

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".md") || entry.endsWith(".mdx")) out.push(full);
  }
  return out;
}

/**
 * Fail loudly on bad frontmatter.
 *
 * Contentlayer2 warned and SKIPPED the document instead: a post with
 * `draft: "false"` -- a string, which is what Obsidian's Properties UI writes
 * when the property type is Text rather than Checkbox -- would vanish from the
 * site with exit code 0 and a green build. /data is about to be edited in
 * Obsidian, so that failure mode is a live risk and is now a hard error.
 */
function fail(file, message) {
  throw new Error(`[content] ${path.relative(process.cwd(), file)}: ${message}`);
}

function optionalString(file, data, field) {
  const value = data[field];
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") {
    fail(file, `"${field}" must be a string, got ${JSON.stringify(value)}`);
  }
  return value;
}

function requiredString(file, data, field) {
  const value = data[field];
  if (typeof value !== "string" || value === "") {
    fail(
      file,
      `"${field}" is required and must be a non-empty string, got ${JSON.stringify(value)}`
    );
  }
  return value;
}

function optionalDate(file, data, field) {
  const value = data[field];
  if (value === undefined || value === null || value === "") return undefined;
  // gray-matter's default YAML engine keeps dates as strings, which is what
  // Contentlayer configured a custom engine to achieve; accept a Date too.
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    fail(file, `"${field}" is not a valid date: ${JSON.stringify(value)}`);
  }
  return date.toISOString();
}

function requiredDate(file, data, field) {
  const value = optionalDate(file, data, field);
  if (value === undefined) fail(file, `"${field}" is required`);
  return value;
}

function booleanField(file, data, field) {
  const value = data[field];
  if (value === undefined || value === null) return false;
  if (typeof value !== "boolean") {
    fail(
      file,
      `"${field}" must be a boolean, got ${JSON.stringify(value)}. ` +
        `In Obsidian, set this property's type to Checkbox.`
    );
  }
  return value;
}

function stringList(file, data, field) {
  const value = data[field];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    fail(file, `"${field}" must be a list, got ${JSON.stringify(value)}`);
  }
  return value.map((item) => {
    if (typeof item !== "string") {
      fail(file, `"${field}" must contain strings, got ${JSON.stringify(item)}`);
    }
    return item;
  });
}

/**
 * Build one document.
 *
 * `requirePublishDate` is the one place Post and Page differ, and it mirrors
 * contentlayer.config.js exactly: Post declares `publishDate` as required,
 * Page declares only `title` and `description`. Asking a Page for a
 * publishDate would throw on the real `about.md`, which has never carried one.
 */
function buildDocument(file, { requirePublishDate = true } = {}) {
  const raw = readFileSync(file, "utf8");
  // The YAML engine is NOT optional. contentlayer2 passes `yaml.parse` from the
  // `yaml` package as gray-matter's engine (makeCacheItemFromFilePath.ts:225)
  // to stop gray-matter coercing date-like strings into Date objects. It also,
  // as a side effect, keeps a trailing CR on the last frontmatter value on a
  // CRLF file -- 55 of 63 posts carry `description: "…\r"`. A plain
  // `matter(raw)` uses js-yaml instead and silently drops that CR, so the shape
  // check reports 55 differences that are not real. Same engine, same output.
  const { data } = matter(raw, { engines: { yaml: (str) => yaml.parse(str) } });
  const flattenedPath = path
    .relative(CONTENT_DIR, file)
    .replace(/\.(md|mdx)$/, "")
    .split(path.sep)
    .join("/");
  const body = stripFrontmatter(raw);

  const document = {
    title: requiredString(file, data, "title"),
    description: optionalString(file, data, "description"),
    publishDate: requirePublishDate
      ? requiredDate(file, data, "publishDate")
      : optionalDate(file, data, "publishDate"),
    lastmod: optionalDate(file, data, "lastmod"),
    image: optionalString(file, data, "image"),
    imageDesc: optionalString(file, data, "imageDesc"),
    draft: booleanField(file, data, "draft"),
    featured: booleanField(file, data, "featured"),
    tags: stringList(file, data, "tags"),
    // Always a list, matching what Contentlayer2 emitted. Its schema declared
    // `default: []` (without `required: false`), and measurement of the real
    // generated output confirms the key is present on all 63 posts with value
    // []. So this is convergence, not a change -- keep it unconditional.
    // `lastmod`, by contrast, is genuinely ABSENT on 44 of 63 posts in
    // Contentlayer2's output; optionalDate returns undefined there, which every
    // consumer already guards for with `post.lastmod ? ... : ...`.
    categories: stringList(file, data, "categories"),

    slug: `/${flattenedPath}`.toLowerCase(),
    urlslug: `/${flattenedPath}`,
    slugAsParams: flattenedPath.split("/").slice(1).join("/").toLowerCase(),

    readingTime: readingTime(body, { wordsPerMinute: 1000 }),
    headings: extractHeadings(body),
    body: { raw: body, html: "" },
  };

  // body.html is lazy. The getter below makes a synchronous read fail loudly
  // until the document has been rendered; the cache lives in a closure rather
  // than as a sibling property so that `getBodyHtml` can test "already
  // rendered?" without touching the getter -- reading the getter to check is
  // what it is designed to reject, so a memo check written that way throws
  // instead of memoizing.
  let htmlPromise = null;
  let renderedHtml = null;
  Object.defineProperty(document.body, "html", {
    enumerable: true,
    configurable: true,
    get() {
      if (renderedHtml !== null) return renderedHtml;
      throw new Error(
        `[content] ${flattenedPath}: body.html is async. ` +
          `Use await getAllPostsWithBody() or await getBodyHtml(document).`
      );
    },
  });

  Object.defineProperty(document, "_renderHtml", {
    enumerable: false,
    value: async () => {
      if (!htmlPromise) htmlPromise = renderMarkdown(body);
      return htmlPromise;
    },
  });

  Object.defineProperty(document, "_setHtml", {
    enumerable: false,
    value: (html) => {
      renderedHtml = html;
    },
  });

  return document;
}

function loadDir(dir, options) {
  return walk(dir)
    .map((file) => buildDocument(file, options))
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}

export const allPosts = loadDir(path.join(CONTENT_DIR, "blog"));
export const allPages = loadDir(path.join(CONTENT_DIR, "pages"), {
  requirePublishDate: false,
});

export function getPost(slugAsParams) {
  return allPosts.find((post) => post.slugAsParams === slugAsParams);
}

export function getPage(slugAsParams) {
  return allPages.find((page) => page.slugAsParams === slugAsParams);
}

/** Resolve one document's rendered HTML (memoized per document). */
export async function getBodyHtml(document) {
  const html = await document._renderHtml();
  document._setHtml(html);
  return html;
}

/**
 * Every post with body.html populated. One await, all documents, still lazy
 * per document -- used by the feed routes, which need every body in one pass.
 */
export async function getAllPostsWithBody() {
  return Promise.all(
    allPosts.map(async (post) => {
      await getBodyHtml(post);
      return post;
    })
  );
}
