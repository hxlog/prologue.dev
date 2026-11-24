/**
 * Feed items + serializers.
 *
 * buildFeedItems() renders every post body through Shiki; it is shared by the
 * three feed formats and must run at most once per build. Cache Components was
 * removed with the move to static export, so a module-level production-only
 * memo keeps that guarantee (dev stays uncached so content edits show up).
 */
import { assembleFeed, buildFeedItems } from "./build-feed";

let itemsMemo = null;

export async function getFeedItems() {
  if (process.env.NODE_ENV === "production" && itemsMemo) return itemsMemo;
  const promise = buildFeedItems();
  if (process.env.NODE_ENV === "production") itemsMemo = promise;
  return promise;
}

export async function getFeedXml(format) {
  const { items, updated } = await getFeedItems();
  const feed = assembleFeed(items, updated);
  if (format === "rss") return feed.rss2().trim();
  if (format === "atom") return feed.atom1().trim();
  return feed.json1();
}
