/**
 * View counts, read from the site's own Umami instance.
 *
 * Umami lives in a SEPARATE DATABASE on the same PostgreSQL cluster, and this
 * module is the only thing in the codebase that opens a connection to it. That
 * isolation is deliberate and worth stating: `prologue` and `umami` are
 * neighbours, not one system, and a query here must never be able to reach the
 * content tables — or, worse, the third database on the cluster that belongs to
 * another project entirely.
 *
 * ## Why its own pool
 *
 * The app's pool points at PgBouncer in transaction mode and carries
 * `prologue_app`'s privileges. Analytics is a different database with a
 * different role, and sharing a pool would mean either one connection string
 * that can reach both (a privilege escalation nobody asked for) or a
 * per-request reconnection. So: a second pool, created on first use, `max: 2`
 * because analytics is a convenience and must not compete for connections with
 * the site.
 *
 * ## Fail soft, and only once
 *
 * Every function here returns `null` when analytics cannot be read, and after
 * the first failure stops trying for the life of the process: a misconfigured
 * URL must not turn every /studio page into a 500, nor add a five-second
 * connection timeout to each render.
 *
 * `null` is NOT zero, and every caller distinguishes them. "0 views" is a fact
 * about the blog; "null" is a fact about the connection. Rendering a confident
 * zero for a broken connection would tell the author their traffic had vanished.
 *
 * ## The umami schema, as observed
 *
 *   website_event.event_type = 1  →  a pageview
 *   website_event.event_type = 5  →  a performance sample (cls/fcp/inp), one
 *                                    per pageview, which is why the two counts
 *                                    are always close but not equal
 *   website_event.url_path        →  the path only, no query string
 *   website_event.session_id      →  one browsing session, several pageviews
 *
 * Counts are aggregated in SQL rather than fetched and counted in JS: the site
 * has ~2,200 events and grows, and shipping them all to count them is the kind
 * of thing that works until it does not.
 */

import pg from "pg";

/** Lazily created; null means "not yet attempted". */
let pool = null;
/** Set once a connection has failed, so we do not retry on every page render. */
let unavailable = false;

function getPool() {
  if (unavailable) return null;
  if (pool) return pool;

  const connectionString = process.env.UMAMI_DATABASE_URL;
  if (!connectionString) {
    unavailable = true;
    return null;
  }

  pool = new pg.Pool({
    connectionString,
    max: 2,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 5_000,
    ssl: false,
    application_name: "prologue-studio-stats",
  });

  // Same reason as the content pool: without a handler, an error on an idle
  // client terminates the process.
  pool.on("error", (err) => {
    console.error("[stats] umami client error:", err.message);
  });

  return pool;
}

async function umamiQuery(text, params) {
  const p = getPool();
  if (!p) return null;
  try {
    const { rows } = await p.query(text, params);
    return rows;
  } catch (err) {
    // Fail soft, and stop trying for the life of this instance. Analytics is a
    // convenience; a misconfigured UMAMI_DATABASE_URL must not turn every
    // /studio page into a 500.
    unavailable = true;
    console.error("[stats] umami unavailable:", err.message);
    return null;
  }
}

function websiteId() {
  return process.env.UMAMI_WEBSITE_ID || null;
}

/**
 * View counts for the dashboard.
 *
 * Returns `null` — not zeroes — when analytics cannot be read. The distinction
 * matters in the UI: "0 views" is a fact about the blog, and "unavailable" is a
 * fact about the connection. Showing a confident zero for a broken connection
 * would have the author believe their traffic had vanished.
 */
export async function getOverview() {
  const id = websiteId();
  if (!id) return null;

  const rows = await umamiQuery(
    `SELECT
       count(*) FILTER (WHERE event_type = 1)::int                          AS pageviews_all,
       count(*) FILTER (
         WHERE event_type = 1 AND created_at >= now() - interval '30 days'
       )::int                                                               AS pageviews_30d,
       count(DISTINCT session_id) FILTER (
         WHERE created_at >= now() - interval '30 days'
       )::int                                                               AS sessions_30d,
       count(DISTINCT session_id)::int                                      AS sessions_all,
       min(created_at)                                                      AS since
     FROM website_event
    WHERE website_id = $1`,
    [id]
  );

  const row = rows?.[0];
  if (!row) return null;

  return {
    pageviews: row.pageviews_all,
    pageviews30d: row.pageviews_30d,
    sessions: row.sessions_all,
    sessions30d: row.sessions_30d,
    since: row.since ? new Date(row.since).toISOString() : null,
  };
}

/**
 * Views per post path, cumulative and over the last 30 days.
 *
 * Keyed by `url_path`, which is `/blog/<slug>` — the same string the posts
 * table's slug column produces, so the dashboard can join the two in JS rather
 * than asking Umami for titles it does not have.
 *
 * The two branches are separate FILTER clauses rather than two queries: one
 * scan, one pass over the index on `website_id`.
 */
export async function getPostViews() {
  const id = websiteId();
  if (!id) return null;

  const rows = await umamiQuery(
    `SELECT url_path,
            count(*)::int AS views,
            count(*) FILTER (WHERE created_at >= now() - interval '30 days')::int AS views_30d
       FROM website_event
      WHERE website_id = $1
        AND event_type = 1
        AND url_path LIKE '/blog/%'
      GROUP BY url_path`,
    [id]
  );

  if (!rows) return null;

  const byPath = new Map();
  for (const row of rows) byPath.set(row.url_path, row);
  return byPath;
}

/**
 * Daily pageviews for the last N days, for the dashboard's little chart.
 *
 * `generate_series` produces the days so a day with no traffic appears as a
 * zero rather than as a missing point — a line chart that skips empty days
 * draws a straight line across a week of silence and reads as steady traffic.
 */
export async function getDailyViews({ days = 30 } = {}) {
  const id = websiteId();
  if (!id) return null;

  const rows = await umamiQuery(
    `SELECT d::date AS day,
            count(e.event_id)::int AS views
       FROM generate_series(
              (now() - ($2::int - 1) * interval '1 day')::date,
              now()::date,
              interval '1 day'
            ) AS d
       LEFT JOIN website_event e
         ON e.website_id = $1
        AND e.event_type = 1
        AND e.created_at >= d
        AND e.created_at < d + interval '1 day'
      GROUP BY d
      ORDER BY d`,
    [id, days]
  );

  if (!rows) return null;

  return rows.map((r) => ({
    day: new Date(r.day).toISOString().slice(0, 10),
    views: r.views,
  }));
}

/** The most-viewed paths of any kind, for the dashboard's "popular" list. */
export async function getTopPaths({ limit = 8, days = 30 } = {}) {
  const id = websiteId();
  if (!id) return null;

  const rows = await umamiQuery(
    `SELECT url_path, count(*)::int AS views
       FROM website_event
      WHERE website_id = $1
        AND event_type = 1
        AND created_at >= now() - ($2::int * interval '1 day')
      GROUP BY url_path
      ORDER BY views DESC, url_path
      LIMIT $3`,
    [id, days, limit]
  );

  if (!rows) return null;
  return rows.map((r) => ({ path: r.url_path, views: r.views }));
}

/** Health check for the settings screen. */
export async function pingUmami() {
  const id = websiteId();
  if (!id) return { ok: false, reason: "UMAMI_WEBSITE_ID 未配置" };

  const sites = await umamiQuery(
    `SELECT website_id, name FROM website WHERE website_id = $1`,
    [id]
  );
  if (!sites) return { ok: false, reason: "无法连接分析数据库" };
  if (!sites.length) return { ok: false, reason: "站点 ID 在分析库中不存在" };

  return { ok: true, site: sites[0].name };
}
