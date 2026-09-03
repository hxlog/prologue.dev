import { createFeed } from "../../lib/feed/build-feed";
import { finalizeJson } from "../../lib/feed/finalize";

// Feed content only changes on deploy; edge-cache for 10 minutes with
// background revalidation so readers always get a fast response and the
// route stops rebuilding ~0.8MB of post HTML on every poll.
const CACHE_CONTROL = "public, s-maxage=600, stale-while-revalidate=86400";

export async function GET() {
  const feed = createFeed();

  return new Response(finalizeJson(feed.json1()), {
    headers: {
      "Content-Type": "application/feed+json; charset=utf-8",
      "Cache-Control": CACHE_CONTROL,
    },
  });
}
