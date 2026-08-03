import { createFeed } from "../../lib/feed/build-feed";

const CACHE_CONTROL = "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400";

export async function GET() {
  const feed = createFeed();

  return new Response(feed.atom1().trim(), {
    headers: {
      "Content-Type": "application/atom+xml; charset=utf-8",
      "Cache-Control": CACHE_CONTROL,
    },
  });
}
