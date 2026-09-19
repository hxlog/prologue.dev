/**
 * The one shape difference between a row and what the callers expect.
 *
 * `size_bytes` is `bigint`, and node-postgres parses it to a STRING — the
 * identity parser, kept because an 8-byte integer exceeds JavaScript's safe
 * range and silently rounding a storage figure would be worse than a type that
 * forces a decision. So the column stays `bigint`; the conversion happens here,
 * once, at the boundary.
 *
 * One place rather than at each call site, because the same row reaches a caller
 * through three different paths — an `INSERT … RETURNING`, a list query, and an
 * `UPDATE … RETURNING` — and two of them do not agree. Found by
 * `scripts/studio/media-test.mjs` asserting `size_bytes === 70` and getting
 * `"70"`: the insert path and the read path returning different types for the
 * same column is a trap that only shows up the first time somebody writes `===`.
 */
export function normaliseMedia(row) {
  if (!row) return row;
  return {
    ...row,
    size_bytes:
      row.size_bytes === null || row.size_bytes === undefined
        ? null
        : Number(row.size_bytes),
  };
}
