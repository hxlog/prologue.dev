import { createFeed } from "../../lib/feed/build-feed";

const CACHE_CONTROL = "no-store, no-cache, must-revalidate";

export async function GET() {
  const feed = createFeed();

  return new Response(feed.atom1().trim(), {
    headers: {
      "Content-Type": "application/atom+xml; charset=utf-8",
      "Cache-Control": CACHE_CONTROL,
    },
  });
}
