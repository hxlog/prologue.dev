/**
 * Cached feed items + serializers.
 *
 * Building the item list is the expensive half: it renders all 65 post bodies
 * through Shiki (via the per-slug `getCachedPost` cache entries, not a second
 * copy). Serialising is cheap -- a `Feed` assembled from already-rendered
 * strings takes single-digit milliseconds.
 *
 * So the two halves are split at the cache boundary:
 *
 *   - getFeedItems() owns the expensive half and runs `'use cache'`, once per
 *     revalidation window rather than once per request (and once per format).
 *     All three feed routes share the SAME item list, so the three serializers
 *     are the only per-format cost.
 *   - getFeedXml() assembles and serialises. It stays a plain async function
 *     because it is pure CPU over strings: wrapping it in a cache would store
 *     three more copies of a ~1 MB document for no benefit. The route remains
 *     STATIC either way -- the clock read the old builder needed (for
 *     `lastBuildDate`) is gone; the timestamp is content-derived inside
 *     buildFeedItems(), so nothing here reads request/current time.
 *
 * The stale window matches the `s-maxage` the routes send (600 s), so the CDN
 * and the function agree about how old a feed may be, and the revalidate window
 * is the same 600 s. cacheTag("feeds") is the invalidation handle for a future
 * revalidateTag() call (there is none today; content only changes on deploy).
 */
import { cacheLife, cacheTag } from "next/cache";
import { assembleFeed, buildFeedItems } from "./build-feed";

/**
 * The full item list (title/link/HTML/dates/categories/enclosure), as plain
 * serialisable data. Shared by every feed format.
 *
 * @returns {Promise<{ items: object[], updated: string | null }>}
 */
export async function getFeedItems() {
  "use cache";
  cacheLife({ stale: 600, revalidate: 600, expire: 604800 });
  cacheTag("feeds");
  return buildFeedItems();
}

/**
 * @param {"rss" | "atom" | "json"} format
 * @returns {Promise<string>} the serialized document, already trimmed
 */
export async function getFeedXml(format) {
  const { items, updated } = await getFeedItems();
  const feed = assembleFeed(items, updated);

  if (format === "rss") return feed.rss2().trim();
  if (format === "atom") return feed.atom1().trim();
  return feed.json1();
}
