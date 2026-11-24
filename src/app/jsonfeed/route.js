import { getFeedXml } from "../../lib/feed/cached";
import { finalizeJson } from "../../lib/feed/finalize";

const CACHE_CONTROL = "public, s-maxage=31536000, stale-while-revalidate=604800";

export async function GET() {
  const json = await getFeedXml("json");

  return new Response(finalizeJson(json), {
    headers: {
      "Content-Type": "application/feed+json; charset=utf-8",
      "Cache-Control": CACHE_CONTROL,
    },
  });
}

// Static export: this handler reads no request data.
export const dynamic = "force-static";
