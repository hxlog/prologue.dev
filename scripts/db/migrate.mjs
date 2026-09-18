#!/usr/bin/env node
/**
 * Migration runner.
 *
 *   node scripts/db/migrate.mjs            # apply pending migrations
 *   node scripts/db/migrate.mjs --status   # list applied / pending / drifted
 *   node scripts/db/migrate.mjs --dry-run  # show what would run
 *   node scripts/db/migrate.mjs --baseline # record pending files as applied,
 *                                          # WITHOUT running them
 *
 * --baseline exists for exactly one situation: adopting this runner on a
 * database whose schema was built by hand. It records the current files as
 * applied so they are not re-run. It does not verify that the objects they
 * create actually exist — running it on an empty database silently produces a
 * schema_migrations table that lies. Only use it when the schema really is
 * already there.
 *
 * Deliberately hand-written rather than pulled from npm. The job is ~150 lines,
 * and the migration tooling that exists either wants to generate migrations from
 * a schema DSL (this schema is raw SQL with extensions, functions, triggers and
 * generated columns — none of which those tools can express) or wants to own the
 * connection (we connect as a specific role against a shared server).
 *
 * Connects to DATABASE_URL_UNPOOLED, not DATABASE_URL. Migrations issue DDL and
 * take session-level advisory locks, and PgBouncer in transaction mode is a
 * session-level-feature-free zone: a plain `SET` there affects whichever backend
 * the next statement happens to land on, and `pg_advisory_lock` is released at
 * a moment we do not control. Direct connection, no pooler.
 *
 * Each file runs in its own transaction so a failure leaves earlier files
 * applied and later ones untouched — a partially-applied sequence is
 * recoverable by fixing the failing file and re-running.
 *
 * A file may opt out with a header comment:
 *     -- migrate:no-transaction
 * which is required for CREATE INDEX CONCURRENTLY (it cannot run inside a
 * transaction block). Such a file must be idempotent, because a mid-file
 * failure leaves it half-applied and it will be retried from the top.
 */

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import pg from "pg";

const MIGRATIONS_DIR = path.join(process.cwd(), "db", "migrations");

// Arbitrary but fixed. Anything that acquires this key is serialised against
// every other migrator; pick one number and never change it.
const ADVISORY_LOCK_KEY = 8_531_207_441_009_331n;

const NO_TRANSACTION = /^--\s*migrate:no-transaction\s*$/m;

/**
 * One object per migration, used only by --baseline to confirm the migration's
 * work is genuinely present. Migrations without an entry are skipped by the
 * check (they are pure data or function replacements).
 */
const SENTINELS = {
  "0001_init.sql": "search_index",
  "0002_auth_pages_revisions.sql": "page_revisions",
  "0003_fix_cjk_tokenizer.sql": null, // replaces functions; nothing to probe
};

function loadConnectionString() {
  // .env.local is not read automatically outside Next, so read it the way the
  // other scripts in this directory do.
  const url =
    process.env.DATABASE_URL_UNPOOLED ||
    process.env.DATABASE_URL ||
    "";
  if (!url) {
    console.error(
      "DATABASE_URL_UNPOOLED is not set.\n" +
        "Load .env.local first, e.g.\n" +
        "  node --env-file=.env.local scripts/db/migrate.mjs"
    );
    process.exit(1);
  }
  if (url.includes(":6432")) {
    console.error(
      "Refusing to migrate through PgBouncer (port 6432).\n" +
        "Session-level advisory locks and SET do not survive transaction " +
        "pooling. Use the direct URL on port 5432."
    );
    process.exit(1);
  }
  return url;
}

export function checksum(sql) {
  // Normalise line endings so a CRLF checkout on Windows does not register as
  // a schema change against an LF one in CI.
  return createHash("sha256").update(sql.replace(/\r\n/g, "\n")).digest("hex");
}

async function readMigrations() {
  const names = (await readdir(MIGRATIONS_DIR))
    .filter((n) => n.endsWith(".sql"))
    .sort();

  return Promise.all(
    names.map(async (name) => {
      const sql = await readFile(path.join(MIGRATIONS_DIR, name), "utf8");
      return {
        name,
        sql,
        checksum: checksum(sql),
        inTransaction: !NO_TRANSACTION.test(sql),
      };
    })
  );
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        text PRIMARY KEY,
      checksum    text NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now(),
      duration_ms int
    )
  `);
}

async function fetchApplied(client) {
  const { rows } = await client.query(
    "SELECT name, checksum, applied_at FROM schema_migrations"
  );
  return new Map(rows.map((r) => [r.name, r]));
}

/**
 * Split a migration into statements.
 *
 * `client.query()` accepts exactly one statement per call unless the simple
 * query protocol is used, and the extended protocol (which pg uses for
 * parameterised queries) refuses multiple. Migrations here are plain DDL with
 * no parameters, so send the whole file as one simple-protocol query — pg does
 * that automatically when no params array is passed. That keeps dollar-quoted
 * function bodies intact, which a naive split on ";" would shred.
 */
async function runFile(client, migration) {
  const started = Date.now();

  if (migration.inTransaction) {
    await client.query("BEGIN");
    try {
      await client.query(migration.sql);
      await client.query(
        "INSERT INTO schema_migrations (name, checksum, duration_ms) VALUES ($1, $2, $3)",
        [migration.name, migration.checksum, Date.now() - started]
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  } else {
    // No transaction: record first so a mid-file failure is not silently
    // retried forever on a foundation that is already half-built. The file is
    // required to be idempotent.
    await client.query(migration.sql);
    await client.query(
      "INSERT INTO schema_migrations (name, checksum, duration_ms) VALUES ($1, $2, $3) " +
        "ON CONFLICT (name) DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = now()",
      [migration.name, migration.checksum, Date.now() - started]
    );
  }

  return Date.now() - started;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const statusOnly = args.has("--status");
  const dryRun = args.has("--dry-run");
  const baseline = args.has("--baseline");

  const migrations = await readMigrations();
  if (migrations.length === 0) {
    console.log("No migrations found in db/migrations.");
    return;
  }

  const client = new pg.Client({
    connectionString: loadConnectionString(),
    application_name: "prologue-migrate",
  });
  await client.connect();

  try {
    // Session-level lock, held for the whole run and released on disconnect.
    // Safe because this connection never passes through PgBouncer.
    await client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_KEY]);
    await ensureMigrationsTable(client);

    const applied = await fetchApplied(client);
    const pending = [];

    for (const m of migrations) {
      const prev = applied.get(m.name);
      if (!prev) {
        pending.push(m);
        continue;
      }
      if (prev.checksum !== m.checksum) {
        // Not fatal by default — editing an applied migration is sometimes the
        // only fix — but it means this database and a fresh one now differ, so
        // it must never pass unseen.
        console.warn(
          `⚠ ${m.name} was modified after it was applied ` +
            `(applied ${prev.applied_at.toISOString()}).\n` +
            `  This database no longer matches a from-scratch build.`
        );
      }
    }

    if (statusOnly) {
      for (const m of migrations) {
        const prev = applied.get(m.name);
        const mark = prev
          ? prev.checksum === m.checksum
            ? "✓ applied"
            : "⚠ drifted"
          : "· pending";
        console.log(`${mark.padEnd(12)} ${m.name}`);
      }
      return;
    }

    if (baseline) {
      // Adopt an existing hand-built schema. Verify the objects are really
      // there before recording anything — a bad baseline is worse than no
      // baseline, because the runner will then never create them.
      const missing = [];
      for (const m of migrations) {
        // Each migration is tied to a sentinel object it is expected to have
        // created. Only the tables this schema is actually made of are checked;
        // functions and indexes are covered transitively.
        const sentinel = SENTINELS[m.name];
        if (!sentinel) continue;
        const { rows } = await client.query(
          "SELECT to_regclass($1) IS NOT NULL AS present",
          [sentinel]
        );
        if (!rows[0].present) missing.push(`${m.name} -> ${sentinel}`);
      }
      if (missing.length > 0) {
        console.error(
          "--baseline refused: the schema does not contain the objects these " +
            "migrations create, so recording them as applied would be a lie:\n  " +
            missing.join("\n  ")
        );
        process.exitCode = 1;
        return;
      }

      for (const m of migrations) {
        await client.query(
          "INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2) " +
            "ON CONFLICT (name) DO UPDATE SET checksum = EXCLUDED.checksum",
          [m.name, m.checksum]
        );
      }
      console.log(`Baselined ${migrations.length} migration(s) as applied.`);
      return;
    }

    if (pending.length === 0) {
      console.log(`Up to date. ${migrations.length} migration(s) applied.`);
      return;
    }

    if (dryRun) {
      console.log(`Would apply ${pending.length} migration(s):`);
      for (const m of pending) {
        console.log(`  ${m.name}${m.inTransaction ? "" : "  (no transaction)"}`);
      }
      return;
    }

    for (const m of pending) {
      process.stdout.write(`Applying ${m.name} ... `);
      try {
        const ms = await runFile(client, m);
        console.log(`ok (${ms} ms)`);
      } catch (err) {
        console.log("FAILED");
        console.error(`\n${m.name}: ${err.message}`);
        if (err.detail) console.error(`detail: ${err.detail}`);
        if (err.hint) console.error(`hint:   ${err.hint}`);
        console.error(`position: ${err.position ?? "n/a"}`);
        process.exitCode = 1;
        return;
      }
    }

    console.log(`\nApplied ${pending.length} migration(s).`);
  } finally {
    // Releasing explicitly is not required (disconnect drops the session) but
    // makes the intent legible and keeps the lock window as short as possible.
    try {
      await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]);
    } catch {
      /* connection already gone */
    }
    await client.end();
  }
}

// Only run when invoked directly; `checksum` is exported for tests.
//
// pathToFileURL, not string concatenation: on Windows argv[1] is
// `D:\...\migrate.mjs`, so `file://` + it produces `file://D:/...` while
// import.meta.url is `file:///D:/...` — the guard silently never matches and
// the script exits 0 having done nothing.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
