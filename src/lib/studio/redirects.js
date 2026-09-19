/**
 * Redirects: the address book a rename leaves behind.
 *
 * See db/migrations/0009_redirects.sql for why the table exists and why the
 * lookup happens in the catch-all route rather than in the proxy.
 *
 * The read is cached and tagged, which is the part worth explaining. A redirect
 * table is read on the 404 path — the one place a reader is already having a bad
 * time — and an uncached query there adds a database round trip to the slowest
 * request the site serves. `cacheLife("max")` is right for the same reason it is
 * right for pages: a retired URL is retired, and a row that changes is a row
 * whose author is standing in /studio watching the invalidation happen.
 *
 * Counting hits is deliberately NOT part of the cached read. The count is a
 * write, it happens on a path that may be served from cache, and a hit counter
 * that only increments when the cache misses is worse than no counter — it
 * would report the traffic that got through the cache and not the traffic that
 * did not. So the increment is fire-and-forget, best effort, and explicitly
 * allowed to be lost: the number is a signal, not a record.
 */

import { cacheLife, cacheTag } from "next/cache";
import { query, queryMany, queryOne } from "../db";

/** A redirect's target, or null. */
export async function resolveRedirect(source) {
  "use cache";
  cacheLife("max");
  cacheTag("redirects");

  const row = await queryOne(
    `SELECT destination, permanent FROM redirects WHERE source = $1`,
    [normalise(source)]
  );
  return row ?? null;
}

/** Every redirect, for the studio's settings screen. Not cached: it is a list. */
export async function listRedirects() {
  return queryMany(
    `SELECT id, source, destination, permanent, hits, last_hit_at, created_at
       FROM redirects
      ORDER BY created_at DESC`
  );
}

/**
 * Create or replace a redirect.
 *
 * An upsert rather than an insert, because renaming A→B and then B→A should
 * leave one entry pointing at where the page actually is now, not two entries
 * forming a cycle. `source <> destination` is enforced by the table; a cycle
 * *across* two rows is the case this cannot catch, and the reason `follow()`
 * below bounds its hops.
 */
export async function setRedirect(source, destination, { permanent = true } = {}) {
  const from = normalise(source);
  const to = normalise(destination);
  if (!from || !to || from === to) return { ok: false, reason: "invalid" };

  await query(
    `INSERT INTO redirects (source, destination, permanent)
     VALUES ($1, $2, $3)
     ON CONFLICT (source) DO UPDATE
       SET destination = EXCLUDED.destination,
           permanent   = EXCLUDED.permanent,
           updated_at  = now()`,
    [from, to, permanent]
  );
  return { ok: true, source: from, destination: to };
}

export async function deleteRedirect(source) {
  const { rowCount } = await query(`DELETE FROM redirects WHERE source = $1`, [
    normalise(source),
  ]);
  return { ok: rowCount === 1 };
}

/**
 * Count a hit.
 *
 * Deliberately unawaited by its caller and deliberately allowed to fail: a
 * reader waiting on a counter UPDATE to be told where a page moved to would be
 * a real cost for a number that is only a signal.
 *
 * ## What this counts, precisely
 *
 * A RENDER, not a request. The redirect is resolved inside the catch-all route,
 * and the result of that render is cached for thirty days — so a second reader
 * arriving inside the same window is served the redirect without this running,
 * and their visit is not counted.
 *
 * That is a weaker number than "hits" suggests, and it is worth being exact
 * about rather than letting the column name imply traffic it does not measure.
 * What it does answer is the question the counter exists for — "is anything
 * still linking to this retired URL?" — because a link that is genuinely still
 * out there keeps arriving in new cache windows and drives the count up, while
 * one nobody follows stays at whatever it was. It is not, and should not be
 * used as, an analytics figure: /studio reads real traffic from Umami.
 */
export function recordHit(source) {
  query(
    `UPDATE redirects SET hits = hits + 1, last_hit_at = now() WHERE source = $1`,
    [normalise(source)]
  ).catch(() => {});
}

/**
 * Follow a chain of redirects to its end.
 *
 * Bounded at eight hops. A→B and B→A is a cycle no single-row constraint can
 * forbid, and a reader hitting one must get a 404 rather than a redirect loop
 * in their browser: a loop is the one redirect failure a visitor cannot get out
 * of by clicking Back.
 */
export async function follow(source, { maxHops = 8 } = {}) {
  let current = normalise(source);
  const seen = new Set([current]);

  for (let hop = 0; hop < maxHops; hop++) {
    const next = await resolveRedirect(current);
    if (!next) return hop === 0 ? null : { destination: current, permanent: true, hops: hop };
    if (seen.has(next.destination)) return null; // cycle — better a 404
    seen.add(next.destination);
    current = next.destination;
  }
  return null;
}

/**
 * Paths are compared without a trailing slash and without a query string.
 *
 * `/about/` and `/about` are the same resource, and a redirect seeded as one
 * must fire for the other. Normalising on both sides of the comparison is the
 * only way that is true; normalising on only one side is how a redirect works
 * for the URL the author typed and not for the one the reader clicked.
 */
function normalise(path) {
  const raw = String(path ?? "").trim();
  if (!raw) return "";
  const withoutOrigin = raw.replace(/^https?:\/\/[^/]+/i, "");
  const withoutQuery = withoutOrigin.split(/[?#]/)[0];
  const withSlash = withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
  return withSlash.length > 1 ? withSlash.replace(/\/+$/, "") : withSlash;
}

export { normalise as normalisePath };
