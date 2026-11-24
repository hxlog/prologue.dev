import Fuse from "fuse.js";

/**
 * Browser-side site search.
 *
 * The corpus is a build-time artifact (public/search-index.json, written by
 * scripts/build-search-index.mjs) and now ships to the browser instead of being
 * queried through /api/search. The Fuse configuration and the result shape are
 * copied from the old route handler so the dialog renderer, snippets, grouping,
 * keyboard navigation and the footer text do not change.
 *
 * Cost, measured 2026-11-24 on the real corpus (66 documents):
 *   raw 734,182 B, gzip 332,669 B, brotli 256,492 B.
 * The index is therefore only fetched on search intent (trigger hover/focus,
 * panel open), never on page load; the module-level promise dedupes it for the
 * lifetime of the tab, and a failed load is not memoised so Retry can recover.
 */

export const MIN_QUERY = 2;
export const RESULT_LIMIT = 12;
export const SNIPPET_LENGTH = 152;
export const SEARCH_INDEX_URL = "/search-index.json";

// Same cap as the old route handler: q = query.trim().slice(0, 80).
const QUERY_MAX_LENGTH = 80;

// Identical to the Fuse options in the former /api/search route handler.
const FUSE_OPTIONS = {
  keys: [
    { name: "title", weight: 1 },
    { name: "tagLabels", weight: 0.8 },
    { name: "description", weight: 0.7 },
    { name: "body", weight: 0.5 },
  ],
  // Matches anywhere, not just near the start — the body is long and the phrase
  // the reader remembers is usually in the middle.
  ignoreLocation: true,
  threshold: 0.32,
  minMatchCharLength: 2,
  includeMatches: true,
  includeScore: true,
};

/**
 * A window of body text around the first hit, split into highlighted and plain
 * segments. If the match was in the title/tags/description only, the body's
 * opening is shown unhighlighted — the result still needs context.
 *
 * Copied verbatim from the old route handler so snippets stay byte-identical.
 */
export function buildSnippet(item, matches) {
  const body = item.body || "";
  const bodyMatch = matches?.find((match) => match.key === "body");
  const indices = (bodyMatch?.indices || [])
    .slice(0, 3)
    .sort((a, b) => a[0] - b[0]);

  if (!indices.length) {
    const fallback = (item.description || body).trim().slice(0, SNIPPET_LENGTH - 32);
    return fallback ? [{ text: fallback, hit: false }] : [];
  }

  const first = indices[0][0];
  let start = Math.max(0, first - 52);
  let end = Math.min(body.length, start + SNIPPET_LENGTH);
  if (end - start < 110) start = Math.max(0, end - 130);

  const text = body.slice(start, end);
  const segments = [];
  let cursor = 0;

  for (const [from, to] of indices) {
    const hitStart = Math.max(0, from - start);
    const hitEnd = Math.min(text.length, to + 1 - start);
    if (hitEnd <= cursor || hitStart >= text.length) continue;
    if (hitStart > cursor) {
      segments.push({ text: text.slice(cursor, hitStart), hit: false });
    }
    segments.push({ text: text.slice(hitStart, hitEnd), hit: true });
    cursor = hitEnd;
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), hit: false });
  }

  return segments;
}

/**
 * Build a reusable searcher over an already-parsed index array.
 * The Fuse instance is created once per index; every keystroke only queries it.
 */
export function createSearch(items) {
  const fuse = new Fuse(items, FUSE_OPTIONS);

  return {
    search(rawQuery) {
      const started = performance.now();
      const q = String(rawQuery ?? "")
        .trim()
        .slice(0, QUERY_MAX_LENGTH);

      if (q.length < MIN_QUERY) {
        return { q, results: [], took: 0 };
      }

      const results = fuse
        .search(q, { limit: RESULT_LIMIT })
        .map(({ item, matches }) => ({
          type: item.type,
          href: item.href,
          title: item.title,
          description: item.description,
          date: item.dateLabel || "",
          read: item.read || "",
          tags: item.tagLabels || [],
          snippet: buildSnippet(item, matches),
        }))
        /* Group posts before pages, preserving Fuse's score order inside each
           group, exactly like the old /api/search handler. */
        .sort((a, b) => (a.type === "post" ? 0 : 1) - (b.type === "post" ? 0 : 1));

      return { q, results, took: Math.round(performance.now() - started) };
    },
  };
}

/**
 * One-shot helper: index array + query -> the exact former /api/search response
 * shape ({ q, results, took }). Used by the Node verification test and kept
 * exported so the old server handler and this module can be diffed directly.
 */
export function searchItems(items, query) {
  return createSearch(items).search(query);
}

let indexPromise = null;

/** Fetch and parse the static corpus. Not memoised on failure. */
export function loadSearchIndex() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("search index is browser-only"));
  }
  if (!indexPromise) {
    indexPromise = fetch(SEARCH_INDEX_URL)
      .then((response) => {
        if (!response.ok) {
          throw new Error("search index request failed: " + response.status);
        }
        return response.json();
      })
      .then((items) => {
        if (!Array.isArray(items)) {
          throw new Error("search index is not an array");
        }
        return items;
      })
      .catch((error) => {
        indexPromise = null;
        throw error;
      });
  }
  return indexPromise;
}

let searcherPromise = null;

/**
 * Load the index once, build its Fuse index once, and hand back the searcher.
 * A rejected attempt is dropped so Retry in the dialog can start a new one.
 */
export function getSearcher() {
  if (!searcherPromise) {
    searcherPromise = loadSearchIndex()
      .then((items) => createSearch(items))
      .catch((error) => {
        searcherPromise = null;
        throw error;
      });
  }
  return searcherPromise;
}

/**
 * Intent preload used by the trigger (hover / focus / open): starts the fetch
 * and the Fuse build while the reader has not typed yet. Failures are ignored
 * here — the panel's own load path reports them and offers Retry.
 */
export function preloadSearchIndex() {
  return getSearcher().then(
    () => true,
    () => false
  );
}
