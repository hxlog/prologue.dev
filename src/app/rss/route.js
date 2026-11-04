import { getFeedXml } from "../../lib/feed/cached";
import { finalizeRss } from "../../lib/feed/finalize";

// Feed content only changes on deploy; edge-cache for 10 minutes with
// background revalidation so readers always get a fast response. The XML
// itself is produced by getFeedXml(), which caches the Shiki render of all 64
// bodies behind 'use cache' instead of repeating it on every poll.
const CACHE_CONTROL = "public, s-maxage=600, stale-while-revalidate=86400";

export async function GET() {
  const xml = await getFeedXml("rss");

  return new Response(finalizeRss(xml), {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": CACHE_CONTROL,
    },
  });
}
