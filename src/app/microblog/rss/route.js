import { Feed } from "feed";
import siteMetadata from "../../../../data/sitemetadata";
import { IMAGE_SIZES } from "../../../../data/image-sizes.js";
import { getMicroblog, entryToHtml } from "../../../lib/microblog";
import { finalizeRss } from "../../../lib/feed/finalize";

const SITE = String(siteMetadata.siteUrl || "").replace(/\/+$/, "");

// .avif is included because microblog images were recompressed to .avif/.webp.
// .svg stays out on purpose: the feed library would emit an enclosure readers
// cannot render (same rule as src/lib/feed/build-feed.js).
const IMAGE_MIME = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
};

function enclosureFor(src) {
  const image = String(src || "").trim();
  if (!image.startsWith("/")) return undefined;
  const ext = image.split(".").pop().toLowerCase();
  const type = IMAGE_MIME[ext];
  if (!type) return undefined;
  // Byte length from the build-generated manifest, not statSync(). A runtime
  // fs/path read of public/ is invisible to @vercel/nft, so the tracer shipped
  // the whole public/ tree into this function's bundle. See
  // src/lib/feed/build-feed.js coverEnclosure() for the same change.
  const entry = IMAGE_SIZES[image];
  if (!entry || !entry.bytes) return undefined;
  return { url: `${SITE}${image}`, type, length: entry.bytes };
}

/**
 * Standalone microblog feed — one universal RSS 2.0 with full text + images
 * (content:encoded carries HTML paragraphs + <figure>s; first image also as
 * enclosure for reader thumbnails, the format Folo and friends prefer).
 */
export async function GET() {
  const entries = getMicroblog();

  const feed = new Feed({
    title: `${siteMetadata.title} · ${siteMetadata.pages.microblog.heading}`,
    description: siteMetadata.pages.microblog.description,
    id: `${SITE}/microblog`,
    link: `${SITE}/microblog`,
    language: siteMetadata.language,
    favicon: `${SITE}${siteMetadata.favicon}`,
    image: `${SITE}${siteMetadata.avatar}`,
    copyright: siteMetadata.copyright,
    // The feed's `updated` only has to be at least as new as its newest entry,
    // and the newest entry's date is right there. Falling back to "now" would
    // be a synchronous clock read, which Cache Components refuses to prerender
    // (the microblog has no entries only in a fresh template; then `updated`
    // is simply omitted, which RSS 2.0 allows).
    updated: entries[0] ? new Date(entries[0].date) : undefined,
    generator: siteMetadata.microblogFeedGenerator,
    ttl: 60,
    feedLinks: { rss: `${SITE}/microblog/rss` },
    author: {
      name: siteMetadata.author,
      email: siteMetadata.feedEmail,
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

  return new Response(finalizeRss(feed.rss2().trim()), {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=600, stale-while-revalidate=86400",
    },
  });
}
