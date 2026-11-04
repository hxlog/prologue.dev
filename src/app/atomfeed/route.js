import { getFeedXml } from "../../lib/feed/cached";

const CACHE_CONTROL = "public, s-maxage=600, stale-while-revalidate=86400";

export async function GET() {
  const xml = await getFeedXml("atom");

  return new Response(xml, {
    headers: {
      "Content-Type": "application/atom+xml; charset=utf-8",
      "Cache-Control": CACHE_CONTROL,
    },
  });
}
