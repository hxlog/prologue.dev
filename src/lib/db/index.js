import { Pool } from "pg";

/**
 * PostgreSQL connection pool.
 *
 * Two connection strings exist on purpose:
 *   DATABASE_URL          -> PgBouncer :6432, transaction pooling. Used by the
 *                            app. `pool_mode = transaction` verified working
 *                            (interactive transactions, savepoints, error
 *                            recovery, prepared statements).
 *   DATABASE_URL_UNPOOLED -> Postgres  :5432 direct. Used by migrations and
 *                            scripts, where session state and long statements
 *                            are legitimate.
 *
 * Why the pool is small (max 3): the server has max_connections = 50 and is
 * shared with umami and another project. Vercel runs many function instances,
 * each with its own pool, and PgBouncer does not remove that fan-out — it
 * moves it. `prologue_app` also carries CONNECTION LIMIT 20 as a hard backstop,
 * so a runaway pool cannot starve the neighbouring databases.
 *
 * idleTimeoutMillis is deliberately 5s rather than pg's 10s default. Vercel's
 * attachDatabasePool computes its post-request wait as idleTimeoutMillis +
 * 100ms, so a defaulted pool pins every invocation open for ~10.1s after its
 * last query. Halving it halves that tail.
 *
 * connectionTimeoutMillis is the load-bearing setting. pg's default is 0 = no
 * timeout, which means that when the pool or the server is exhausted every
 * request hangs until the platform's own ceiling and then 504s, holding the
 * function instance the whole time. 10s turns a site-wide hang into one fast,
 * legible error.
 */

const globalForDb = globalThis;

function sslConfig() {
  if (process.env.DATABASE_SSL !== "require") return false;
  const ca = process.env.DATABASE_SSL_CA;
  return ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: true };
}

function poolConfig() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and fill it in."
    );
  }

  return {
    connectionString,
    max: Number(process.env.PG_POOL_MAX || 3),
    min: 0,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 10_000,
    // The pooled endpoint is reached over a raw TCP tunnel to a self-hosted
    // server. TLS availability depends on how that tunnel terminates, so it is
    // opt-in via env rather than assumed.
    //
    // Certificate verification stays ON. `rejectUnauthorized: false` would
    // silently accept any certificate and make the connection trivially
    // MITM-able on a network we do not control, which defeats the point of the
    // tunnel. If the server uses a self-signed certificate, supply it:
    //   DATABASE_SSL=require
    //   DATABASE_SSL_CA=<path to the CA PEM>
    ssl: sslConfig(),
    application_name: "prologue",
  };
}

function createPool() {
  const pool = new Pool(poolConfig());

  // Without this listener node-postgres kills the whole process when an IDLE
  // client errors (server restart, network partition, failover). The docs are
  // explicit: "if a pool emits an error event and no listeners are added node
  // will emit an uncaught error". We want one connection recycled, not the
  // function instance terminated.
  pool.on("error", (err) => {
    console.error("[db] idle client error:", err.message);
  });

  return pool;
}

/** The shared pool. Reused across HMR reloads in dev so we do not leak pools. */
export const pool = globalForDb.__prologuePool ?? createPool();
if (process.env.NODE_ENV !== "production") {
  globalForDb.__prologuePool = pool;
}

/**
 * Vercel's helper keeps a function instance alive just long enough for idle
 * connections to close, instead of having them cut mid-close at freeze.
 * Optional: it is @experimental and only supports pg (it throws on
 * postgres.js), and it must be attached exactly once per pool.
 *
 * The specifier is held in a variable rather than written inline so the
 * bundler does not try to resolve it at build time. A literal
 * `import("@vercel/functions")` is a static dependency to Turbopack, which
 * then fails the build on a package that is intentionally not installed — the
 * try/catch only helps at runtime, after the bundle already exists.
 */
const VERCEL_FUNCTIONS = "@vercel/functions";

let attached = false;
if (!attached && !globalForDb.__prologuePoolAttached) {
  try {
    // Dynamic so a missing @vercel/functions (local dev, CI) is not fatal.
    const mod = await import(/* webpackIgnore: true */ VERCEL_FUNCTIONS);
    if (typeof mod.attachDatabasePool === "function") {
      mod.attachDatabasePool(pool);
      globalForDb.__prologuePoolAttached = true;
      attached = true;
    }
  } catch {
    // Not on Vercel, or the package is not installed. Nothing to do.
  }
}

/**
 * Run a parameterised query. Throws on error — callers decide what that means.
 *
 * The duration is measured with `performance.now()`, not `Date.now()`. Both
 * would work for a log line, but `Date.now()` reads the wall clock, and reading
 * the wall clock during prerender is an unstable value: with `cacheComponents`
 * on, Next refuses to prerender a page whose output would depend on the current
 * time. The clock here is telemetry, not output, so the monotonic timer is both
 * the more appropriate primitive and the one that does not make every querying
 * page unprerenderable.
 */
export async function query(text, params) {
  const started = performance.now();
  try {
    return await pool.query(text, params);
  } catch (err) {
    // Surface the statement shape without leaking values into logs.
    console.error("[db] query failed", {
      ms: Math.round(performance.now() - started),
      sql: text.replace(/\s+/g, " ").slice(0, 160),
      code: err.code,
      message: err.message,
    });
    throw err;
  }
}

/** Convenience: run a query and return the first row, or null. */
export async function queryOne(text, params) {
  const { rows } = await query(text, params);
  return rows[0] ?? null;
}

/** Convenience: return the row array. */
export async function queryMany(text, params) {
  const { rows } = await query(text, params);
  return rows;
}

/**
 * Run `fn` inside a transaction, on ONE dedicated connection.
 *
 * Never use the pool directly inside a transaction: `pool.query()` may pick a
 * different connection than the one holding the BEGIN, so the statements would
 * land outside the transaction. Always take a client, and always release it.
 *
 * The client is a `PoolClient`, not a `Pool` — this is the pool used by the
 * publish flow, which is a genuine read-then-write sequence and therefore an
 * interactive transaction (the reason PgBouncer is in transaction mode rather
 * than statement mode).
 */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      console.error("[db] rollback failed:", rollbackErr.message);
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Health probe used by /studio and the readiness script. */
export async function ping() {
  const { rows } = await query(
    "select current_database() as db, current_user as usr, version() as version"
  );
  return rows[0];
}
