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
import { writeFileSync } from "node:fs";
import path from "node:path";
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
