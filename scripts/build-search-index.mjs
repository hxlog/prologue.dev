/**
 * Build-time generation of public/search-index.json — the corpus behind the
 * site-wide search dialog.
 *
 * The index is intentionally NOT shipped to the browser any more: it now holds
 * the full plain-text body of every post and page (~700 KB), so it is read on
 * the server by /api/search only. The dialog fetches results, not the index.
 *
 * Fields:
 *   type        "post" | "page"
 *   href        canonical link (posts already carry /blog/…, pages /about)
 *   title/description/tags/tagLabels
 *   body        plain text: fences and HTML removed, code text kept
 *   date/read   pre-formatted in the author's timezone (Beijing)
 *   featured    the home page's featured flag (posts only)
 *
 * Reads the loader directly rather than a generated JSON file: there is no
 * codegen step in front of 'next build' any more.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const { default: tagLabels } = await import(
  pathToFileURL(path.join(ROOT, "data", "tagLabels.js"))
);
const { getPosts, getPages } = await import(
  pathToFileURL(path.join(ROOT, "src", "lib", "content", "standalone.js"))
);
const { formatDate, readingTimeLabel } = await import(
  pathToFileURL(path.join(ROOT, "src", "lib", "date.js"))
);

const OUT = path.join(ROOT, "public", "search-index.json");

/** Markdown -> plain text. Fences lose their markers but keep the code text;
 *  links keep their label; inline HTML and emphasis markers are dropped. */
function plainText(markdown) {
  return String(markdown || "")
    .replace(/~~~[\s\S]*?~~~/g, " ")
    .replace(/\x60\x60\x60[^\n]*\n/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_~\x60>]/g, "")
    .replace(/\|/g, " ")
    .replace(/&[a-zA-Z]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const posts = getPosts()
  .filter((post) => post.draft !== true)
  .map((post) => {
    const tags = post.tags || [];
    return {
      type: "post",
      href: post.slug,
      slug: post.slugAsParams,
      title: post.title,
      description: post.description || "",
      tags,
      // Chinese labels make 经济/社会/… queries hit English-tagged posts.
      tagLabels: tags.map((tag) => tagLabels[tag] || tag),
      body: plainText(post.body.raw),
      date: post.publishDate,
      dateLabel: post.publishDate ? formatDate(post.publishDate) : "",
      read: readingTimeLabel(post.readingTime),
      featured: Boolean(post.featured),
    };
  });

const pages = getPages()
  .filter((page) => page.draft !== true)
  .map((page) => ({
    type: "page",
    href: "/" + page.slugAsParams,
    slug: page.slugAsParams,
    title: page.title,
    description: page.description || "",
    tags: [],
    tagLabels: [],
    body: plainText(page.body.raw),
    date: page.publishDate || "",
    dateLabel: page.publishDate ? formatDate(page.publishDate) : "",
    read: "",
    featured: false,
  }));

const index = [...posts, ...pages];
const json = JSON.stringify(index);
writeFileSync(OUT, json);
console.log(
  "search-index: wrote " + posts.length + " posts + " + pages.length +
    " pages (" + (Buffer.byteLength(json) / 1024).toFixed(0) +
    " KB) to public/search-index.json"
);

// The route manifest is consumed by proxy.js to turn unknown dynamic paths into
// real 404s before the streaming render starts. It is generated here so the
// list always matches the content tree.
const tags = [...new Set(posts.flatMap((post) => post.tags))];
const routeManifest = {
  static: [
    "/",
    "/blog",
    "/microblog",
    "/links",
    "/ui",
    "/about",
    "/rss",
    "/atomfeed",
    "/jsonfeed",
    "/microblog/rss",
    "/og",
    "/api/search",
    "/_not-found",
    "/llms.txt",
    "/llms-full.txt",
    "/robots.txt",
    "/sitemap.xml",
    "/favicon.ico",
    "/icon.ico",
    "/apple-icon.png",
  ],
  public: readdirSync(path.join(ROOT, "public"))
    .filter((name) => statSync(path.join(ROOT, "public", name)).isFile())
    .map((name) => "/" + name),
  posts: posts.map((post) => post.href),
  pages: pages.map((page) => page.href),
  tags: tags.map((tag) => "/tags/" + tag),
};
writeFileSync(
  path.join(ROOT, "data", "route-manifest.js"),
  "export const ROUTE_MANIFEST = " + JSON.stringify(routeManifest) + ";\n"
);
// ---------------------------------------------------------------------------
// data/image-sizes.js — the one manifest that replaces runtime `fs` + `sharp`.
//
// Why it exists: the markdown pipeline used to read every body image with
// `sharp(path.join(process.cwd(), "public", <dynamic>))` to learn its intrinsic
// size. A path built at runtime is invisible to @vercel/nft, so the tracer
// included the ENTIRE public/ directory (55 MB, 220 files) in every route's
// serverless function. The same lookup also powered the feeds' enclosure
// `length` (a W3C requirement) and the "is the first image small enough to be
// the eager LCP candidate" decision.
//
// One generated table serves all three. It is committed (like
// data/route-manifest.js) so a clean checkout builds without running this
// script first; every `yarn dev` / `yarn build` refreshes it, and the write is
// skipped when nothing changed so the tree stays clean.
// ---------------------------------------------------------------------------
const IMAGE_RE = /\.(png|jpe?g|gif|webp|avif|svg)$/i;

function walkImages(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walkImages(full, out);
    else if (IMAGE_RE.test(entry)) out.push(full);
  }
  return out;
}

const imageSizes = {};
for (const full of walkImages(path.join(ROOT, "public"))) {
  const key = "/" + path.relative(path.join(ROOT, "public"), full).split(path.sep).join("/");
  const bytes = statSync(full).size;
  let width = 0;
  let height = 0;
  try {
    // Animated sources (gif/webp) must be opened as animations, otherwise sharp
    // reports a single 1px-high page for them.
    const meta = await sharp(full, {
      animated: /\.(gif|webp)$/i.test(full),
    }).metadata();
    width = meta.width || 0;
    // Animated sources report the STACKED height (frame count × frame height).
    // Layout needs one frame, or the reserved box would be 268 screens tall.
    const pages = meta.pages && meta.pages > 1 ? meta.pages : 1;
    height = pages > 1 ? Math.round((meta.pageHeight || meta.height / pages) || 0) : meta.height || 0;
  } catch {
    // Unreadable/unsupported asset: keep the byte length (feeds need it) and
    // leave the dimensions at 0, which the renderer treats as "no size known".
  }
  imageSizes[key] = { w: width, h: height, bytes };
}

const imageSizesPath = path.join(ROOT, "data", "image-sizes.js");
const imageSizesSource =
  "// GENERATED by scripts/build-search-index.mjs — do not edit by hand.\n" +
  "export const IMAGE_SIZES = " + JSON.stringify(imageSizes) + ";\n";

let previous = "";
try {
  previous = (await import("node:fs")).readFileSync(imageSizesPath, "utf8");
} catch {
  previous = "";
}
if (previous !== imageSizesSource) {
  writeFileSync(imageSizesPath, imageSizesSource);
}
console.log(
  "image-sizes: " +
    Object.keys(imageSizes).length +
    " assets (" +
    (Buffer.byteLength(imageSizesSource) / 1024).toFixed(0) +
    " KB)" +
    (previous === imageSizesSource ? " — unchanged" : " — updated")
);
// ---------------------------------------------------------------------------
// Image-reference gate.
//
// The image tree is content-hashed now (public/static/opt/**) and the markdown
// pipeline resolves sizes from the table above instead of stat-ing files, so a
// renamed or missing asset would no longer throw — it would silently render
// without width/height (a layout shift) or a broken image. Fail the build
// instead: every local image a content file names must exist and be in the table.
// ---------------------------------------------------------------------------
const CONTENT_REF = /(?:!\[[^\]]*\]\(|image:\s*["']?|src:\s*)(\/static\/[^\s)"']+)/g;
const referenced = new Set();
function walkContent(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walkContent(full, out);
    else if (/\.(md|mdx)$/i.test(entry)) out.push(full);
  }
  return out;
}
for (const file of walkContent(path.join(ROOT, "data", "content"))) {
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(CONTENT_REF)) {
    referenced.add(match[1].split("?")[0].split("#")[0]);
  }
}
for (const yamlName of ["microblog.yaml", "links.yaml"]) {
  const yamlPath = path.join(ROOT, "data", yamlName);
  if (!existsSync(yamlPath)) continue;
  const text = readFileSync(yamlPath, "utf8");
  for (const match of text.matchAll(/(\/static\/[^\s"',)]+)/g)) {
    referenced.add(match[1].split("?")[0].split("#")[0]);
  }
}
const missingFiles = [...referenced].filter(
  (ref) => !existsSync(path.join(ROOT, "public", ref.replace(/^\//, "")))
);
if (missingFiles.length > 0) {
  throw new Error(
    "Content references " +
      missingFiles.length +
      " image(s) that do not exist under public/:\n  " +
      missingFiles.join("\n  ")
  );
}
// The renderers read the table for intrinsic size, so anything they can draw
// must have an entry; .ico (friend-link avatars) is listed but never drawn by
// the markdown pipeline.
const renderable = /(png|jpe?g|gif|webp|avif|svg)$/i;
const missingSizes = [...referenced].filter(
  (ref) => renderable.test(ref) && !imageSizes[ref]
);
if (missingSizes.length > 0) {
  throw new Error(
    "Content references " +
      missingSizes.length +
      " image(s) missing from data/image-sizes.js:\n  " +
      missingSizes.join("\n  ")
  );
}
console.log(
  "image-refs: " + referenced.size + " referenced assets all present and sized"
);
