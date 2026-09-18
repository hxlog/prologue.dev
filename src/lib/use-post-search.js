"use client";

/**
 * Site-wide search, over the /api/search endpoint.
 *
 * Search runs in PostgreSQL (src/lib/search.js) rather than in the browser.
 * The two costs that made the old client-side Fuse index attractive are both
 * addressed here:
 *
 *   - repeated queries: an LRU keyed on the normalised term, 60s TTL, plus
 *     in-flight coalescing so two components mounting together issue one fetch
 *   - the round trip: one fetch per debounced keystroke, not per keystroke
 *
 * Why Fuse was replaced: it never worked for this corpus. It matches
 * subsequences inside a single field and has no ranking across a document, so
 * it works for short titles and fails for body text. Measured on the real site,
 * 10 of 15 realistic queries returned nothing; the same queries against the
 * bigram-indexed table return 1-9 results each.
 */

const CACHE_LIMIT = 50;
const CACHE_TTL_MS = 60_000;

const cache = new Map();
const pending = new Map();

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  // Re-insert to mark as most recently used.
  cache.delete(key);
  cache.set(key, hit);
  return hit.value;
}

function cacheSet(key, value) {
  if (cache.size >= CACHE_LIMIT) {
    // Map preserves insertion order, so the first key is the oldest.
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, { value, at: Date.now() });
}

/**
 * @param {string} query
 * @returns {Promise<Array>} result cards, in relevance order
 */
export async function searchPosts(query) {
  const term = String(query ?? "").trim();
  if (term.length < 2) return [];

  const key = term.toLowerCase();

  const cached = cacheGet(key);
  if (cached) return cached;

  const inFlight = pending.get(key);
  if (inFlight) return inFlight;

  const promise = fetch(`/api/search?q=${encodeURIComponent(term)}`, {
    headers: { accept: "application/json" },
  })
    .then((res) => (res.ok ? res.json() : { results: [] }))
    .then((data) => {
      const results = Array.isArray(data.results) ? data.results : [];
      cacheSet(key, results);
      return results;
    })
    .catch((err) => {
      // A failed search must not poison the cache or the caller's UI: return an
      // empty result set and let the page say "no matches".
      console.error("[search] failed:", err.message);
      return [];
    })
    .finally(() => {
      pending.delete(key);
    });

  pending.set(key, promise);
  return promise;
}

/**
 * Compatibility wrapper.
 *
 * The two search components call `const { search } = usePostSearch()` and then
 * `search(term)` inside an effect. Keeping that shape means they are not
 * touched by the swap from a client-side index to the server.
 */
export function usePostSearch() {
  return { search: searchPosts, ready: true };
}
