import siteMetadata from "../../data/sitemetadata";
import { getPosts, getPages } from "./content/index.js";
import { getMicroblog } from "./microblog.js";
import { absoluteUrl } from "./seo.js";

function publishedPosts() {
  return getPosts().filter((post) => post.draft !== true);
}

function publishedPages() {
  return getPages().filter((page) => page.draft !== true);
}

function postUrl(post) {
  return absoluteUrl("/blog/" + post.slugAsParams);
}

export function buildLlmsIndex() {
  const posts = publishedPosts()
    .slice()
    .sort((a, b) => new Date(b.publishDate) - new Date(a.publishDate));

  const lines = [
    "# " + siteMetadata.title,
    "",
    "> " + siteMetadata.description,
    "",
    "A personal blog about economics, sociology, technology and ordinary life. All canonical pages are in the sitemap; the full text is in /llms-full.txt and the RSS/Atom/JSON feeds.",
    "",
    "## Feeds",
    "- RSS: " + absoluteUrl("/rss"),
    "- Atom: " + absoluteUrl("/atomfeed"),
    "- JSON Feed: " + absoluteUrl("/jsonfeed"),
    "- Microblog RSS: " + absoluteUrl("/microblog/rss"),
    "",
    "## Site",
    "- Home: " + absoluteUrl("/"),
    "- Archive: " + absoluteUrl("/blog"),
    "- Microblog: " + absoluteUrl("/microblog"),
    "- About: " + absoluteUrl("/about"),
    "- Friend links: " + absoluteUrl("/links"),
    "- UI standard: " + absoluteUrl("/ui"),
    "- Full text: " + absoluteUrl("/llms-full.txt"),
    "",
    "## Posts",
    ...posts.map(
      (post) =>
        "- [" + post.title + "](" + postUrl(post) + ")" +
        (post.description ? ": " + post.description : "")
    ),
    "",
    "## Pages",
    ...publishedPages().map(
      (page) =>
        "- [" + page.title + "](" + absoluteUrl("/" + page.slugAsParams) + ")" +
        (page.description ? ": " + page.description : "")
    ),
    "",
  ];

  return lines.join("\n");
}

export function buildLlmsFull() {
  const posts = publishedPosts()
    .slice()
    .sort((a, b) => new Date(b.publishDate) - new Date(a.publishDate));

  const lines = [
    "# " + siteMetadata.title + " — full text",
    "",
    "> " + siteMetadata.description,
    "",
    "Canonical index: " + absoluteUrl("/llms.txt"),
    "",
    "## Posts",
    "",
  ];

  for (const post of posts) {
    lines.push(
      "### " + post.title,
      "",
      "- URL: " + postUrl(post),
      "- Published: " + post.publishDate,
      post.tags?.length ? "- Tags: " + post.tags.join(", ") : "",
      "",
      String(post.body?.raw || "").trim(),
      ""
    );
  }

  lines.push("## Pages", "");
  for (const page of publishedPages()) {
    lines.push(
      "### " + page.title,
      "",
      "- URL: " + absoluteUrl("/" + page.slugAsParams),
      "",
      String(page.body?.raw || "").trim(),
      ""
    );
  }

  lines.push("## Microblog", "");
  for (const entry of getMicroblog()) {
    lines.push(
      "### " + entry.date,
      "",
      "- URL: " + absoluteUrl("/microblog#" + entry.id),
      "",
      entry.paragraphs.join("\n\n"),
      ...(entry.images || []).map(
        (image) => "![" + (image.desc || "image") + "](" + absoluteUrl(image.src) + ")"
      ),
      ""
    );
  }

  return lines.filter((line) => line !== undefined).join("\n");
}
