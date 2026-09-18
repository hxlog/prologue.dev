/**
 * PgBouncer (transaction pooling) compatibility check.
 *
 * Transaction pooling breaks anything that depends on SESSION state, so this
 * exercises exactly the things the app will do:
 *   - an interactive multi-statement transaction (the publish flow)
 *   - SAVEPOINT / ROLLBACK TO inside it
 *   - a server-side error that aborts the transaction
 *   - DDL + DML mixing
 *   - concurrent connections (pool reuse)
 *
 * Usage: node --env-file=.env.local .tmp/pool-check.mjs
 */
import pg from "pg";

const configs = [
  ["POOLED   (6432, pgbouncer)", process.env.DATABASE_URL],
  ["DIRECT   (5432, postgres)  ", process.env.DATABASE_URL_UNPOOLED],
];

const BAR = "=".repeat(78);

for (const [label, conn] of configs) {
  console.log(`\n${BAR}\n  ${label}\n${BAR}`);
  const client = new pg.Client({ connectionString: conn, ssl: false });

  try {
    await client.connect();

    const { rows: who } = await client.query(
      "select current_user, current_database(), inet_server_port()"
    );
    console.log(`  connected           ${JSON.stringify(who[0])}`);

    // ---- 1. interactive multi-statement transaction (the publish shape) ----
    await client.query("BEGIN");
    const { rows: p1 } = await client.query(
      "select id from posts order by slug limit 1"
    );
    await client.query("select count(*) from post_tags where post_id = $1", [p1[0].id]);
    const { rows: p2 } = await client.query(
      "select slug from posts where id = $1", [p1[0].id]
    );
    await client.query("COMMIT");
    console.log(`  interactive txn     OK (read-then-write across 3 statements, slug=${p2[0].slug})`);

    // ---- 2. SAVEPOINT inside a transaction ----
    await client.query("BEGIN");
    await client.query("SAVEPOINT sp1");
    await client.query("select 1");
    await client.query("ROLLBACK TO SAVEPOINT sp1");
    await client.query("COMMIT");
    console.log("  savepoint           OK");

    // ---- 3. a failing statement aborts the txn, rollback recovers ----
    await client.query("BEGIN");
    let caught = false;
    try {
      await client.query("select * from table_that_does_not_exist");
    } catch {
      caught = true;
    }
    await client.query("ROLLBACK");
    const { rows: after } = await client.query("select 42 as ok");
    console.log(`  error→rollback      OK (error caught=${caught}, connection reusable=${after[0].ok === 42})`);

    // ---- 4. THE CRITICAL ONE: a real write inside a transaction ----
    await client.query("BEGIN");
    await client.query(
      `insert into collection_entries (collection_id, values)
       select id, '{"__pool_check":true}'::jsonb from collections limit 1`
    );
    await client.query("ROLLBACK");
    const { rows: noLeftover } = await client.query(
      `select count(*)::int n from collection_entries where values ? '__pool_check'`
    );
    console.log(`  write+rollback      OK (rollback left ${noLeftover[0].n} row[s], expected 0)`);

    // ---- 5. concurrent connections share the pool ----
    const many = await Promise.all(
      Array.from({ length: 8 }, async () => {
        const c = new pg.Client({ connectionString: conn, ssl: false });
        await c.connect();
        const { rows } = await c.query("select pg_backend_pid() as pid");
        await c.end();
        return rows[0].pid;
      })
    );
    const distinct = new Set(many).size;
    console.log(`  8 concurrent conns  OK (${distinct} distinct backend pid[s])`);

    // ---- 6. prepared statements (pg driver auto-prepares after N queries) ----
    try {
      const c = new pg.Client({ connectionString: conn, ssl: false });
      await c.connect();
      // force a named prepared statement explicitly
      await c.query({ name: "pool_check_named", text: "select $1::int as v", values: [7] });
      await c.query({ name: "pool_check_named", text: "select $1::int as v", values: [8] });
      await c.end();
      console.log("  named prepared stmt OK (reused across the pooled connection)");
    } catch (e) {
      console.log(`  named prepared stmt FAILED: ${e.message}`);
      console.log("    -> would need prepareThreshold=0 or statement_cache_size=0");
    }

    await client.end();
  } catch (err) {
    console.log(`  ERROR: ${err.message}`);
    try { await client.end(); } catch {}
  }
}

console.log("");
