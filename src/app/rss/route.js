import { createFeed } from "../../lib/feed/build-feed";
import { finalizeRss } from "../../lib/feed/finalize";

/**
 * Feed content only changes when the author publishes, and publishing
 * invalidates this route's cache tag. The long s-maxage is a CDN-level
 * backstop for the window between a publish and the tag propagating; the
 * stale-while-revalidate keeps readers off the function while that happens.
 */
const CACHE_CONTROL = "public, s-maxage=600, stale-while-revalidate=86400";

export async function GET() {
  const feed = await createFeed();

  return new Response(finalizeRss(feed.rss2().trim()), {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": CACHE_CONTROL,
    },
  });
}
