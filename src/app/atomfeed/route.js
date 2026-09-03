import { createFeed } from "../../lib/feed/build-feed";

// Feed content only changes on deploy; edge-cache for 10 minutes with
// background revalidation so readers always get a fast response and the
// route stops rebuilding ~0.8MB of post HTML on every poll.
const CACHE_CONTROL = "public, s-maxage=600, stale-while-revalidate=86400";

export async function GET() {
  const feed = createFeed();

  return new Response(feed.atom1().trim(), {
    headers: {
      "Content-Type": "application/atom+xml; charset=utf-8",
      "Cache-Control": CACHE_CONTROL,
    },
  });
}
