import { statSync } from "node:fs";
import path from "node:path";
import { Feed } from "feed";
import { getAllPostsWithBody } from "../content";
import { compareDesc } from "date-fns";
import siteMetadata from "../../../data/sitemetadata";
import { buildFeedContent } from "./content";
import { absolutize, postUrl, siteUrl } from "./urls";

const AUTHOR = {
  name: siteMetadata.author,
  email: "hello@prologue.dev",
  link: `${siteUrl()}/about`,
};

const IMAGE_MIME = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

/**
 * Build a spec-valid RSS/Atom enclosure for a post's local cover image, with a
 * real byte `length` (W3C requires a positive integer; Folo uses an
 * `image/*` enclosure to populate the entry thumbnail). Returns undefined for
 * posts without a real local cover (e.g. dynamic OG cards), which then carry no
 * enclosure rather than an invalid zero-length one.
 */
function coverEnclosure(post) {
  const image = String(post.image || "").trim();
  if (!image.startsWith("/")) return undefined;

  const ext = image.split(".").pop().toLowerCase();
  const type = IMAGE_MIME[ext];
  if (!type) return undefined;

  try {
    const { size } = statSync(path.join(process.cwd(), "public", image));
    if (!size) return undefined;
    return { url: absolutize(image), type, length: size };
  } catch {
    return undefined;
  }
}

/**
 * Build a single `Feed` instance shared by the RSS, Atom and JSON Feed
 * routes. The routes only choose the serializer (`rss2`/`atom1`/`json1`),
 * which keeps the three formats perfectly consistent.
 *
 * Async because body.html is: the loader renders lazily, so the feeds await
 * every body up front (one pass, then synchronous reads inside the loop).
 * Reading post.body.html without that await throws rather than emitting an
 * empty item, which is the failure mode this replaced.
 */
export async function createFeed() {
  const site = siteUrl();

  const feed = new Feed({
    title: siteMetadata.title,
    description: siteMetadata.description,
    id: `${site}/`,
    link: `${site}/`,
    language: siteMetadata.language,
    favicon: `${site}${siteMetadata.favicon}`,
    image: `${site}${siteMetadata.avatar}`,
    copyright: "CC BY-NC-SA 4.0",
    updated: new Date(),
    generator: "prologue.dev feed pipeline",
    ttl: 60,
    feedLinks: {
      rss: `${site}/rss`,
      atom: `${site}/atomfeed`,
      json: `${site}/jsonfeed`,
    },
    author: AUTHOR,
  });

  const posts = (await getAllPostsWithBody())
    .filter((post) => post.draft === false)
    .sort((a, b) => compareDesc(new Date(a.publishDate), new Date(b.publishDate)));

  for (const post of posts) {
    const url = postUrl(post.slug);
    const published = new Date(post.publishDate);
    const updated = post.lastmod ? new Date(post.lastmod) : published;

    feed.addItem({
      title: post.title,
      id: url,
      link: url,
      description: post.description,
      content: buildFeedContent(post),
      author: [AUTHOR],
      date: updated,
      published,
      enclosure: coverEnclosure(post),
      category: (post.tags || []).map((name) => ({ name })),
    });
  }

  return feed;
}
