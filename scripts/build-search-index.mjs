/**
 * Build-time generation of public/search-index.json — a slim search index
 * (title/description/slug/tags/labels/date) used by the site-wide Fuse.js
 * search. Keeps the FULL post bodies out of the client bundle (previously
 * the search component imported the generated content module and shipped
 * ~2MB of HTML to anyone focusing the search box).
 *
 * Reads the loader directly rather than a generated JSON file: there is no
 * codegen step in front of `next build` any more.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const { default: tagLabels } = await import(
  pathToFileURL(path.join(ROOT, "data", "tagLabels.js"))
);
const { getPosts } = await import(
  pathToFileURL(path.join(ROOT, "src", "lib", "content", "standalone.js"))
);

const OUT = path.join(ROOT, "public", "search-index.json");

const index = getPosts()
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
