import { createFeed } from "../../lib/feed/build-feed";
import { finalizeJson } from "../../lib/feed/finalize";

const CACHE_CONTROL = "no-store, no-cache, must-revalidate";

export async function GET() {
  const feed = createFeed();

  return new Response(finalizeJson(feed.json1()), {
    headers: {
      "Content-Type": "application/feed+json; charset=utf-8",
      "Cache-Control": CACHE_CONTROL,
    },
  });
}
