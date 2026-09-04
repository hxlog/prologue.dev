import { statSync } from "node:fs";
import path from "node:path";
import { Feed } from "feed";
import siteMetadata from "../../../../data/sitemetadata";
import { getMicroblog, entryToHtml } from "../../../lib/microblog";

const SITE = String(siteMetadata.siteUrl || "").replace(/\/+$/, "");

const IMAGE_MIME = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

function enclosureFor(src) {
  const image = String(src || "").trim();
  if (!image.startsWith("/")) return undefined;
  const ext = image.split(".").pop().toLowerCase();
  const type = IMAGE_MIME[ext];
  if (!type) return undefined;
  try {
    const { size } = statSync(path.join(process.cwd(), "public", image));
    if (!size) return undefined;
    return { url: `${SITE}${image}`, type, length: size };
  } catch {
    return undefined;
  }
}

/**
 * Standalone microblog feed — one universal RSS 2.0 with full text + images
 * (content:encoded carries HTML paragraphs + <figure>s; first image also as
 * enclosure for reader thumbnails, the format Folo and friends prefer).
 */
export async function GET() {
  const entries = getMicroblog();

  const feed = new Feed({
    title: `${siteMetadata.title} · 微博`,
    description: `${siteMetadata.description}（微博：图文与随想）`,
    id: `${SITE}/microblog`,
    link: `${SITE}/microblog`,
    language: siteMetadata.language,
    favicon: `${SITE}${siteMetadata.favicon}`,
    image: `${SITE}${siteMetadata.avatar}`,
    copyright: "CC BY-NC-SA 4.0",
    updated: entries[0] ? new Date(entries[0].date) : new Date(),
    generator: "prologue.dev microblog feed",
    ttl: 60,
    feedLinks: { rss: `${SITE}/microblog/rss` },
    author: {
      name: siteMetadata.author,
      email: "hello@prologue.dev",
      link: `${SITE}/about`,
    },
  });

  for (const entry of entries) {
    const url = `${SITE}/microblog#${entry.id}`;
    const date = new Date(entry.date);
    const first = entry.paragraphs[0] || "微博";

    feed.addItem({
      title: `${first.slice(0, 40)}${first.length > 40 ? "…" : ""}`,
      id: url,
      guid: url,
      link: url,
      description: first.slice(0, 120),
      content: entryToHtml(entry, (src) =>
        String(src).startsWith("/") ? `${SITE}${src}` : src
      ),
      author: [{ name: siteMetadata.author }],
      date,
      category: [{ name: "microblog" }],
      enclosure: entry.images[0] ? enclosureFor(entry.images[0].src) : undefined,
    });
  }

  return new Response(feed.rss2().trim(), {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=600, stale-while-revalidate=86400",
    },
  });
}
