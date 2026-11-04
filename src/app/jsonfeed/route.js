import { getFeedXml } from "../../lib/feed/cached";
import { finalizeJson } from "../../lib/feed/finalize";

const CACHE_CONTROL = "public, s-maxage=600, stale-while-revalidate=86400";

export async function GET() {
  const json = await getFeedXml("json");

  return new Response(finalizeJson(json), {
    headers: {
      "Content-Type": "application/feed+json; charset=utf-8",
      "Cache-Control": CACHE_CONTROL,
    },
  });
}
