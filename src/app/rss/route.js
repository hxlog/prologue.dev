import { createFeed } from "../../lib/feed/build-feed";
import { finalizeRss } from "../../lib/feed/finalize";

const CACHE_CONTROL = "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400";

export async function GET() {
  const feed = createFeed();

  return new Response(finalizeRss(feed.rss2().trim()), {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": CACHE_CONTROL,
    },
  });
}
