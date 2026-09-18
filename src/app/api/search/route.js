import { NextResponse } from "next/server";
import { searchPosts } from "../../../lib/search";

/**
 * Search endpoint.
 *
 * Search runs in PostgreSQL against the bigram-indexed `search_index` table —
 * see src/lib/search.js for why Fuse.js was replaced and db/README.md for why
 * the query has to go through `zh_q()`.
 *
 * This is an API route rather than a server action because the query is a GET
 * with no side effects: it can be cached by the CDN and by `fetch`, deduped by
 * the browser, and reached with a plain URL when debugging. A server action
 * would be POST-only and would opt the whole page out of static rendering.
 *
 * Seeded with the query, so an empty query is not a database round-trip.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q") ?? "";
  const limit = Math.min(Number(searchParams.get("limit") ?? 40) || 40, 100);

  if (query.trim().length < 2) {
    return NextResponse.json(
      { results: [] },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const results = await searchPosts(query, { limit });
    return NextResponse.json(
      { results },
      {
        headers: {
          // Content only changes when the author publishes, and a publish
          // invalidates the tag. The short s-maxage bounds the window in which
          // a reader could see a stale result set.
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
        },
      }
    );
  } catch (err) {
    console.error("[api/search] failed:", err.message);
    return NextResponse.json(
      { results: [], error: "search_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
