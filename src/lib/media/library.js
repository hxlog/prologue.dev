/**
 * The media library's reads.
 *
 * ## The database is the library; Blob is the bytes
 *
 * Every screen reads `media`, not the store. That is not a caching decision, it
 * is the content model: alt text, captions and the original filename live in the
 * row, and a grid built from a store listing is a file browser — it can show you
 * `9f3c1a2b.jpg` and nothing about what is in it, nor which of the objects
 * anything actually links to. The store is consulted in exactly two places: the
 * upload commit (to confirm the object landed) and `media-reconcile.mjs` (to
 * find the rows and blobs that disagree).
 *
 * ## Plain Node, with one cached exception
 *
 * Nothing here imports `next/cache` except `isMediaPublished` at the bottom,
 * which is the one read that sits in front of a public request and therefore
 * genuinely needs a cache. Everything above it is importable from a script —
 * see the note in `usage.js` for why that matters.
 *
 * The publication check itself is in `usage.js`, because the delete
 * precondition and the proxy's authorisation question are the same question and
 * there is no version of this codebase where the two answers should be allowed
 * to differ.
 */

import { query, queryMany } from "../db";
import { normaliseMedia } from "./rows";
import { isPublishedRow } from "./usage";

/** One page of the library, newest first. */
export async function listMedia({ query: search = "", limit = 60, offset = 0 } = {}) {
  const term = String(search ?? "").trim();

  const where = term
    ? `WHERE original_name ILIKE $1 OR alt ILIKE $1 OR caption ILIKE $1 OR pathname ILIKE $1`
    : "";
  const params = term ? [`%${term}%`] : [];

  const rows = await queryMany(
    `SELECT id, pathname, original_name, mime_type, size_bytes, width, height,
            alt, caption, created_at
       FROM media
       ${where}
      -- id as the tiebreaker: a batch upload shares a millisecond, and a grid
      -- that reshuffles between two renders of the same data is unexplainable.
      ORDER BY created_at DESC, id DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, clampInt(limit, 1, 500), clampInt(offset, 0, 100_000)]
  );
  return rows.map(normaliseMedia);
}

export async function countMedia({ query: search = "" } = {}) {
  const term = String(search ?? "").trim();
  const { rows } = await query(
    term
      ? `SELECT count(*)::int AS n FROM media
          WHERE original_name ILIKE $1 OR alt ILIKE $1 OR caption ILIKE $1 OR pathname ILIKE $1`
      : `SELECT count(*)::int AS n FROM media`,
    term ? [`%${term}%`] : []
  );
  return rows[0].n;
}

export async function getMedia(id) {
  const { rows } = await query(
    `SELECT id, pathname, original_name, mime_type, size_bytes, width, height,
            alt, caption, created_at
       FROM media WHERE id = $1`,
    [id]
  );
  return normaliseMedia(rows[0] ?? null);
}

/**
 * Is this object reachable by a reader?
 *
 * Cached, and it has to be: this runs on every `/api/img` request, which means
 * once per image per page view. Uncached, a photograph-heavy post would issue
 * one query per `<img>` on every hit.
 *
 * Safe to cache BECAUSE the tag is dropped in both directions — a media write
 * changes the library, and a POST write changes what is published, so
 * `invalidatePost` drops `media` as well. See the note on `TAGS.media` in
 * src/lib/studio/cache-tags.js. Without that, an image uploaded into a draft and
 * then published would keep answering "not published" and readers would get a
 * 404 for a picture visibly in the post in front of them.
 */
export async function isMediaPublished(pathname) {
  "use cache";
  const { cacheLife, cacheTag } = await import("next/cache");
  cacheLife("max");
  cacheTag("media");

  return isPublishedRow(pathname);
}

function clampInt(value, min, max) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.min(Math.max(n, min), max);
}
