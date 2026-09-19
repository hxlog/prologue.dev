#!/usr/bin/env node
/**
 * The seed migration must be a NO-OP on a populated database.
 *
 * This is the property that matters and the one that is invisible until it is
 * violated. `0012_seed_collections.sql` is written with `ON CONFLICT DO
 * NOTHING` on every statement so that a deploy cannot revert whatever the author
 * has changed in /studio since the import — but "every statement" is a claim
 * about 44 INSERTs across 280 lines, and a single one written as a plain INSERT
 * or an upsert would look perfectly reasonable in review.
 *
 * So it is run. Twice: once to prove it applies, once to prove that applying it
 * again changes nothing at all — row counts, values, anchors and sort orders
 * before and after.
 *
 *   node --env-file=.env.local scripts/db/check-seed-idempotent.mjs
 */

import pg from "pg";

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL_UNPOOLED,
  ssl: false,
});
await client.connect();

let pass = 0;
const failures = [];

function ok(name, condition, detail = "") {
  if (condition) pass++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
}

async function snapshot() {
  const { rows: collections } = await client.query(
    `SELECT slug, name, description, ordering, icon, public_read FROM collections ORDER BY slug`
  );
  const { rows: fields } = await client.query(
    `SELECT c.slug, f.key, f.label, f.type, f.required, f.sort_order
       FROM collection_fields f JOIN collections c ON c.id = f.collection_id
      ORDER BY c.slug, f.key`
  );
  const { rows: entries } = await client.query(
    `SELECT c.slug, e.anchor, e.status, e.values, e.sort_order, e.published_at
       FROM collection_entries e JOIN collections c ON c.id = e.collection_id
      ORDER BY c.slug, e.sort_order, e.anchor`
  );
  return { collections, fields, entries };
}

const sql = (await import("node:fs")).readFileSync(
  "db/migrations/0012_seed_collections.sql",
  "utf8"
);

const before = await snapshot();

// Apply it the way the migration runner would: in one transaction.
await client.query("BEGIN");
try {
  await client.query(sql);
  await client.query("COMMIT");
} catch (err) {
  await client.query("ROLLBACK");
  ok("the seed applies cleanly", false, err.message);
}

const after = await snapshot();

ok("collections unchanged", before.collections.length === after.collections.length);
ok("fields unchanged", before.fields.length === after.fields.length);
ok("entries unchanged", before.entries.length === after.entries.length);

for (const table of ["collections", "fields", "entries"]) {
  const a = JSON.stringify(before[table]);
  const b = JSON.stringify(after[table]);
  ok(
    `the ${table} are byte-identical after re-applying the seed`,
    a === b,
    a === b ? "" : "the seed modified existing rows"
  );
}

// A count is the weak form of the same check — two rows could swap values and
// the count would not notice — so both are asserted and the deep compare above
// is the one that counts.
const { rows: counts } = await client.query(
  `SELECT
     (SELECT count(*)::int FROM collections) AS collections,
     (SELECT count(*)::int FROM collection_fields) AS fields,
     (SELECT count(*)::int FROM collection_entries) AS entries`
);
ok("two collections exist", counts[0].collections === 2, `${counts[0].collections}`);
ok("entries are present", counts[0].entries === 35, `${counts[0].entries}`);

const { rows: anchors } = await client.query(
  `SELECT count(*)::int AS n FROM collection_entries WHERE anchor LIKE 'mb-%'`
);
ok("the 26 microblog anchors are still there", anchors[0].n === 26, `${anchors[0].n}`);

console.log(`\nassertions: ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`\n  FAIL  ${f}`);
  process.exitCode = 1;
} else {
  console.log("OK — the seed is idempotent and non-destructive.");
}

await client.end();
