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
  // Forward slashes, not the platform's: the message is compared verbatim in
  // verification steps and quoted in the docs, and a Windows path prints as
  // `data\content\blog\x.md`, which no reader recognizes as a file on the site.
  const rel = path.relative(process.cwd(), file).split(path.sep).join("/");
  throw new Error(`[content] ${rel}: ${message}`);
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

/**
 * Canonicalize the date strings the vault actually contains.
 *
 * The YAML engine keeps dates as strings (see the note in buildDocument), and
 * /data is hand-edited in Obsidian, so both `2025-04-13` and `2023-6-19` and
 * `2026-3-7 12:00` occur in the same tree.
 *
 * Passing those straight to `new Date()` is a bug, because the two shapes
 * resolve in different zones: ES2015+ requires the zero-padded `YYYY-MM-DD`
 * form to be read as UTC, while a loose `2023-6-19` misses that grammar and
 * falls back to LOCAL time -- so the same post resolved to a different instant
 * (and, west of UTC+8, a different calendar day) depending on the machine
 * running the build. Padding the components makes every form UTC-midnight.
 *
 * A clock time is different: the site's policy is that a time is Beijing time
 * (`src/lib/date.js`), so the offset is stated explicitly instead of being
 * inherited from the host.
 */
function canonicalDate(value) {
  const dateOnly = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
  const dateTime = /^(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?$/;

  const only = dateOnly.exec(value);
  if (only) {
    const [, y, m, d] = only;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  const timed = dateTime.exec(value);
  if (timed) {
    const [, y, m, d, hh, mm, ss = "00"] = timed;
    return (
      `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}` +
      `T${hh.padStart(2, "0")}:${mm}:${ss}+08:00`
    );
  }

  return value;
}

function optionalDate(file, data, field) {
  const value = data[field];
  if (value === undefined || value === null || value === "") return undefined;
  // gray-matter's default YAML engine keeps dates as strings, which is what
  // Contentlayer configured a custom engine to achieve; accept a Date too.
  const date =
    value instanceof Date ? value : new Date(canonicalDate(String(value)));
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
  // to stop gray-matter coercing date-like strings into Date objects -- and the
  // shape check compares what that engine produces. A plain `matter(raw)` uses
  // js-yaml instead, which yields Date objects for `publishDate`/`lastmod` and
  // would differ from the baseline on every dated post. Same engine, same
  // output.
  //
  // Dates therefore arrive here as STRINGS in whatever shape the vault holds
  // them (`2025-04-13`, `2023-6-19`, `2026-3-7 12:00`); canonicalDate is what
  // makes those parse the same on every machine.
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
    // Opt-in page avatar. See the note in src/app/[...slug]/page.js: pages are
    // pure markdown and the pipeline drops raw HTML outright, so anything with
    // styling on it has to be named here and rendered by the page template
    // instead of written in the body. Pages only; posts never set it.
    avatar: optionalString(file, data, "avatar"),
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

/**
 * The content snapshot, refreshed when the files on disk change.
 *
 * WHY THIS IS NOT A MODULE CONSTANT. Markdown read with readFileSync is not in
 * the module graph, and every bundler watches the module graph -- so a
 * `const allPosts = loadDir(...)` at module scope freezes at first evaluation
 * and a content edit in `next dev` keeps serving the stale HTML until the
 * server is restarted. Measured on Turbopack 16.3.4, both documented escapes
 * fail: `import.meta.glob` matches 0 files for the root-absolute AND the
 * parent-relative pattern with `query: "?raw"`, and
 * `import.meta.turbopackHot.invalidate()` does not re-evaluate its caller.
 *
 * So the refresh happens here, off the mtime+size signature of the tree:
 * ~1.2 ms to check over 64 files, against ~103 ms to re-parse. A changed tree
 * is re-parsed once and cached again; an unchanged one costs the signature.
 * That price is paid on access rather than per request, and there is no
 * bundler-specific code anywhere in it -- which also keeps this file loadable
 * from a plain `node scripts/...` run, where no bundler exists at all.
 *
 * The signature is skipped under NODE_ENV=production. There the tree is fixed
 * for the life of the process: `next build` reads it, prerenders, and exits,
 * and a running `next start` is not expected to pick up edits to files inside
 * its own deployment. Checking would stat 64 files per access to detect a
 * change that cannot happen.
 */
const RECHECK = process.env.NODE_ENV !== "production";

function signatureOf(dir) {
  let signature = "";
  for (const file of walk(dir)) {
    const stats = statSync(file);
    signature += `${file} ${stats.mtimeMs} ${stats.size}\n`;
  }
  return signature;
}

let snapshot = null;

function current() {
  try {
    const signature = RECHECK ? signatureOf(CONTENT_DIR) : null;
    if (snapshot && snapshot.signature === signature) return snapshot;
    snapshot = {
      signature,
      posts: loadDir(path.join(CONTENT_DIR, "blog")),
      pages: loadDir(path.join(CONTENT_DIR, "pages"), {
        requirePublishDate: false,
      }),
    };
  } catch (error) {
    // An editor saving a file replaces it atomically: for a few milliseconds
    // the path does not exist. That is not a content error, and rethrowing
    // would 500 a page that reloads cleanly a moment later. Only ENOENT/EBUSY
    // are tolerated, and only while a previous snapshot is in hand. The failed
    // load leaves that snapshot's OLD signature in place, so the next access
    // sees the mismatch and tries again -- the state cannot stick. Malformed
    // frontmatter does not qualify: `fail()` and `yaml.parse` raise errors
    // carrying no `code`, and rethrow immediately, which is the point of
    // `fail()`.
    const transient = error.code === "ENOENT" || error.code === "EBUSY";
    if (!snapshot || !transient) throw error;
  }
  return snapshot;
}

export function getPosts() {
  return current().posts;
}

export function getPages() {
  return current().pages;
}

export function getPost(slugAsParams) {
  return getPosts().find((post) => post.slugAsParams === slugAsParams);
}

export function getPage(slugAsParams) {
  return getPages().find((page) => page.slugAsParams === slugAsParams);
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
    getPosts().map(async (post) => {
      await getBodyHtml(post);
      return post;
    })
  );
}
