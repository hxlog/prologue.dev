import { createFeed } from "../../lib/feed/build-feed";
import { finalizeJson } from "../../lib/feed/finalize";

const CACHE_CONTROL = "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400";

export async function GET() {
  const feed = createFeed();

  return new Response(finalizeJson(feed.json1()), {
    headers: {
      "Content-Type": "application/feed+json; charset=utf-8",
      "Cache-Control": CACHE_CONTROL,
    },
  });
}
