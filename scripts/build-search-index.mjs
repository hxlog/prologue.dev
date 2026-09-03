/**
 * Build-time generation of public/search-index.json — a slim search index
 * (title/description/slug/tags/labels/date) used by the site-wide Fuse.js
 * search. Keeps the FULL post bodies out of the client bundle (previously
 * the search component imported contentlayer's generated module and shipped
 * ~2MB of HTML to anyone focusing the search box).
 *
 * Runs after `contentlayer2 build`, before `next build` (see package.json).
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const { default: tagLabels } = await import(
  pathToFileURL(path.join(ROOT, "data", "tagLabels.js"))
);

const GENERATED = path.join(ROOT, ".contentlayer", "generated", "Post", "_index.json");
const OUT = path.join(ROOT, "public", "search-index.json");

const posts = JSON.parse(readFileSync(GENERATED, "utf8"));

const index = posts
  .filter((post) => post.draft !== true)
  .map((post) => {
    const tags = post.tags || [];
    const labels = tags.map((tag) => tagLabels[tag] || tag);
    return {
      title: post.title,
      description: post.description || "",
      slug: post.slug,
      tags,
      // Chinese labels make 经济/社会/… queries hit English-tagged posts.
      text: [post.title, post.description || "", ...tags, ...labels]
        .filter(Boolean)
        .join(" "),
      date: post.publishDate,
      readingTime: post.readingTime?.text || "",
      featured: Boolean(post.featured),
    };
  });

writeFileSync(OUT, JSON.stringify(index));
console.log(`search-index: wrote ${index.length} posts to public/search-index.json`);
