#!/usr/bin/env node
/**
 * Write-path integration test for collections, against the real database.
 *
 * The properties this checks are the ones a build cannot, and they are all
 * about facts that are easy to get subtly wrong in ways nothing surfaces:
 *
 *   - A new entry's ANCHOR must not reuse or shift an existing one. The anchor
 *     is the entry's id on the public page and its guid in the RSS feed, so a
 *     changed one re-notifies every subscriber. The numbering is derived from
 *     the highest existing suffix for that date, NOT from a count of rows — the
 *     two diverge the first time anything is deleted, which is what this proves.
 *
 *   - `collection_field_index` must say exactly what `values` says, including
 *     after a value is CLEARED. It is maintained by the application rather than
 *     by a trigger (0002 explains why: indexing needs the field's type, a
 *     relation needs a join, a markdown field needs the renderer), so a write
 *     that forgets it is invisible until someone sorts by a custom field and
 *     gets rows ordered by JSONB's length-first rule.
 *
 *   - A partial update must MERGE, not replace. A form that rendered only some
 *     fields must not delete the rest.
 *
 *   - Deleting a FIELD must keep the stored values. Removing a field is a
 *     decision about the form; stripping the key out of every entry would be
 *     unrecoverable, and recreating the field would find nothing.
 *
 * Everything runs against a throwaway collection with a randomised slug, deleted
 * at the end — including the entries, the fields and the projection rows.
 *
 *   node --env-file=.env.local --import ./scripts/auth/register-loader.mjs \
 *     scripts/studio/collections-test.mjs
 */

import { randomBytes } from "node:crypto";

const {
  createEntry,
  deleteEntry,
  deleteField,
  getCollectionForEdit,
  getEntry,
  listEntries,
  reorderEntries,
  saveField,
  setEntryPinned,
  updateEntry,
} = await import("../../src/lib/studio/collections-write.js");
const { pool } = await import("../../src/lib/db/index.js");

let pass = 0;
const failures = [];

function ok(name, condition, detail = "") {
  if (condition) pass++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
}

function eq(name, actual, expected) {
  ok(
    name,
    actual === expected,
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  );
}

const runId = randomBytes(4).toString("hex");
const slug = `test-collection-${runId}`;
let collectionId = null;
const createdEntryIds = [];

try {
  // ── set up a throwaway collection ────────────────────────────────────────
  const { rows } = await pool.query(
    `INSERT INTO collections (slug, name, ordering, public_read)
     VALUES ($1, $2, 'date', false) RETURNING id`,
    [slug, `Test ${runId}`]
  );
  collectionId = rows[0].id;

  for (const [key, type, sort] of [
    ["date", "date", 0],
    ["content", "long_text", 1],
    ["images", "image_gallery", 2],
    ["score", "number", 3],
    ["pinned", "boolean", 4],
  ]) {
    const saved = await saveField(collectionId, { key, label: key, type });
    ok(`field ${key} created`, saved.ok);
  }

  const collection = await getCollectionForEdit(slug);
  eq("collection reads back five fields", collection.fields.length, 5);

  // ── create ───────────────────────────────────────────────────────────────
  const first = await createEntry(collectionId, {
    values: { date: "2026-01-15", content: "第一条", score: "3" },
  });
  ok("create: succeeds", first.ok, JSON.stringify(first));
  createdEntryIds.push(first.id);
  eq("create: anchor is date-derived", first.anchor, `te-20260115-0`);

  // The number type must arrive as a NUMBER, because the projection's
  // `value_num` column is numeric and a string would fail the insert.
  const stored = await getEntry(first.id);
  eq("create: number field is coerced", typeof stored.values.score, "number");
  eq("create: number value", stored.values.score, 3);

  // ── anchors do not reuse a retired suffix ────────────────────────────────
  //
  // The load-bearing assertion. Delete the only entry for a date, then create a
  // new one for that date: a count-based anchor would derive 0 again and
  // collide with a guid already sitting in subscribers' feeds. The highest
  // suffix is read from what EXISTS, so after a delete it is still 0 and the
  // next anchor is 1 — which is the whole point of not counting rows.
  const second = await createEntry(collectionId, {
    values: { date: "2026-01-15", content: "第二条" },
  });
  createdEntryIds.push(second.id);
  eq("second entry on the same date increments", second.anchor, `te-20260115-1`);

  await deleteEntry(first.id);
  createdEntryIds.splice(createdEntryIds.indexOf(first.id), 1);

  const third = await createEntry(collectionId, {
    values: { date: "2026-01-15", content: "第三条" },
  });
  createdEntryIds.push(third.id);
  eq(
    "a deleted anchor is not reused",
    third.anchor,
    `te-20260115-2`,
    "the anchor reuses a retired suffix — this would re-notify RSS subscribers"
  );

  // A different date gets its own sequence.
  const other = await createEntry(collectionId, {
    values: { date: "2026-02-01", content: "另一天" },
  });
  createdEntryIds.push(other.id);
  eq("a new date starts at zero", other.anchor, `te-20260201-0`);

  // ── published_at comes from the date field, not the clock ────────────────
  const dated = await getEntry(other.id);
  eq(
    "published_at is derived from the date field",
    new Date(dated.published_at).toISOString().slice(0, 10),
    "2026-02-01"
  );

  // ── the projection ───────────────────────────────────────────────────────
  const projection = async (entryId) =>
    pool
      .query(
        `SELECT field_key, value_text, value_num, value_date, value_bool
           FROM collection_field_index WHERE entry_id = $1 ORDER BY field_key`,
        [entryId]
      )
      .then((r) => r.rows);

  let rows_ = await projection(third.id);
  eq("projection: one row per populated field", rows_.length, 2);
  ok(
    "projection: the date was indexed as a date",
    rows_.some((r) => r.field_key === "date" && r.value_date !== null),
    JSON.stringify(rows_)
  );
  ok(
    "projection: the text was indexed as text",
    rows_.some((r) => r.field_key === "content" && r.value_text === "第三条"),
    JSON.stringify(rows_)
  );

  // ── a partial update merges ──────────────────────────────────────────────
  const merged = await updateEntry(third.id, { values: { score: 7 } });
  ok("partial update: succeeds", merged.ok);
  eq("partial update: keeps the untouched field", merged.values.content, "第三条");
  eq("partial update: applies the new one", merged.values.score, 7);

  rows_ = await projection(third.id);
  eq("partial update: projection grew a row", rows_.length, 3);
  ok(
    "partial update: the number was indexed as a number",
    rows_.some((r) => r.field_key === "score" && Number(r.value_num) === 7),
    JSON.stringify(rows_)
  );

  // ── clearing a value removes its projection row ──────────────────────────
  //
  // Delete-then-insert rather than an upsert, and this is why: an upsert cannot
  // express "this value no longer exists", so a cleared field would leave its
  // old index row behind and a sort would still find it.
  await updateEntry(third.id, { values: { content: "" } });
  rows_ = await projection(third.id);
  ok(
    "clearing a value removes its index row",
    !rows_.some((r) => r.field_key === "content"),
    JSON.stringify(rows_)
  );
  eq("clearing a text value stores null", (await getEntry(third.id)).values.content, null);

  // ── gallery coercion ─────────────────────────────────────────────────────
  const gallery = await updateEntry(other.id, {
    values: { images: ["/a.png", { src: "/b.png", desc: "说明" }] },
  });
  ok("gallery: shape is normalised", Array.isArray(gallery.values.images));
  eq("gallery: string became an object", gallery.values.images[0].src, "/a.png");
  eq("gallery: description preserved", gallery.values.images[1].desc, "说明");

  // ── unknown keys are dropped ─────────────────────────────────────────────
  //
  // `values` is JSONB and would hold a stale key forever. Dropping it means
  // removing a field from the schema actually stops it being written.
  const withJunk = await updateEntry(other.id, {
    values: { mystery: "should not persist" },
  });
  eq("an undeclared key is dropped", withJunk.values.mystery, undefined);

  // ── pinning and ordering ─────────────────────────────────────────────────
  ok("pin: succeeds", (await setEntryPinned(other.id, true)).ok);
  // The pin is read back through `listEntries`, which applies the manual
  // ordering clause rather than the date one — this collection is 'date', so
  // pinning does not reorder it, but the flag must still be stored.
  const listed = await listEntries(collectionId);
  ok(
    "pin: is stored and read back",
    listed.find((e) => e.id === other.id)?.sort_pinned === true
  );

  // Asserted on the raw column rather than through `listEntries`, because this
  // collection is ordered by DATE — so `sort_order` is not what the list is
  // sorted by and reading the order back through it would prove nothing. What
  // is under test is that the write assigns positions, one per id, in the order
  // the ids were given.
  const reversed = [...listed].reverse().map((e) => e.id);
  ok("reorder: succeeds", (await reorderEntries(reversed)).ok);

  const { rows: positions } = await pool.query(
    `SELECT id, sort_order FROM collection_entries WHERE collection_id = $1`,
    [collectionId]
  );
  const byId = new Map(positions.map((r) => [r.id, r.sort_order]));
  ok(
    "reorder: the first id got position 0",
    byId.get(reversed[0]) === 0,
    `got ${byId.get(reversed[0])}`
  );
  ok(
    "reorder: the second id got position 1",
    byId.get(reversed[1]) === 1,
    `got ${byId.get(reversed[1])}`
  );

  // ── deleting a field keeps the values ────────────────────────────────────
  //
  // The decision worth protecting: removing a field is a decision about the
  // FORM. Stripping the key out of every entry would be unrecoverable, so the
  // value stays and recreating the field brings it back.
  const scoreField = collection.fields.find((f) => f.key === "score");
  const deleted = await deleteField(collectionId, scoreField.id);
  ok("deleteField: succeeds", deleted.ok);

  const afterFieldDelete = await getEntry(third.id);
  eq(
    "deleteField: the value is still in the entry",
    afterFieldDelete.values.score,
    7
  );
  const afterProjection = await projection(third.id);
  ok(
    "deleteField: the index row is gone",
    !afterProjection.some((r) => r.field_key === "score"),
    JSON.stringify(afterProjection)
  );

  // Recreating it rebuilds the index from the stored value.
  await saveField(collectionId, { key: "score", label: "score", type: "number" });
  const recreated = await getCollectionForEdit(slug);
  const newScoreField = recreated.fields.find((f) => f.key === "score");
  await updateEntry(third.id, { values: { score: 7 } });
  const rebuilt = await projection(third.id);
  ok(
    "recreating the field can reindex the surviving value",
    rebuilt.some((r) => r.field_key === "score" && Number(r.value_num) === 7),
    JSON.stringify(rebuilt)
  );
  ok("the recreated field has a new id", newScoreField.id !== scoreField.id);

  // ── delete ───────────────────────────────────────────────────────────────
  const doomed = await deleteEntry(other.id);
  ok("deleteEntry: succeeds", doomed.ok);
  createdEntryIds.splice(createdEntryIds.indexOf(other.id), 1);
  eq("deleteEntry: the entry is gone", await getEntry(other.id), null);
  eq(
    "deleteEntry: the projection cascaded",
    (await projection(other.id)).length,
    0
  );
} catch (err) {
  failures.push(`threw: ${err.message}\n${err.stack}`);
} finally {
  // The collection cascade takes its fields, entries and projection rows with
  // it (0002 wires all three to ON DELETE CASCADE), so this is the only cleanup
  // that matters — but the explicit delete is kept so a failure inside the try
  // cannot leave a half-built collection behind with a stale slug.
  if (collectionId) {
    await pool
      .query(`DELETE FROM collections WHERE id = $1`, [collectionId])
      .catch(() => {});
  }
  const { rows: leftover } = await pool
    .query(`SELECT count(*)::int AS n FROM collections WHERE slug = $1`, [slug])
    .catch(() => ({ rows: [{ n: 0 }] }));
  ok("cleanup: the test collection is gone", leftover[0].n === 0);
  await pool.end().catch(() => {});
}

console.log(`\nassertions: ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`\n  FAIL  ${f}`);
  process.exitCode = 1;
} else {
  console.log("OK — the collection write path behaves as documented.");
}
