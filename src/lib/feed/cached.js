/**
 * Cached feed serializer.
 *
 * createFeed() renders every post body (Shiki) before any format can be
 * emitted, and it used to do that per request: the three routes are dynamic
 * (ƒ) because the builder awaited io() for a clock read. A single cold request
 * therefore paid the whole corpus, and a burst of pollers paid it repeatedly.
 *
 * 'use cache' moves that to a revalidation boundary. The stale window matches
 * the s-maxage the routes already send, so the CDN and the function agree about
 * how old a feed may be, and content only changes on deploy anyway.
 */
import { cacheLife } from "next/cache";
import { createFeed } from "./build-feed";

/**
 * @param {"rss" | "atom" | "json"} format
 * @returns {Promise<string>} the serialized document, already trimmed
 */
export async function getFeedXml(format) {
  "use cache";
  cacheLife({ stale: 600, revalidate: 3600, expire: 86400 });

  const feed = await createFeed(new Date());

  if (format === "rss") return feed.rss2().trim();
  if (format === "atom") return feed.atom1().trim();
  return feed.json1();
}
