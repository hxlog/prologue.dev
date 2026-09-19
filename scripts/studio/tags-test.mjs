#!/usr/bin/env node
/**
 * Taxonomy write-path test, against the real database.
 *
 * Three properties, each of which is a public-URL correctness property rather
 * than an internal one:
 *
 *   - A rename must leave an ALIAS behind, in the same transaction. Without it
 *     every inbound link to `/tags/<old>` becomes a 404, and the author has no
 *     way to know which links those were. The test renames a throwaway tag and
 *     then asserts that `resolve_tag_slug()` — the function the tag page
 *     actually calls — still resolves the old slug.
 *
 *   - A tag in use must NOT be deletable. Deleting it would silently drop those
 *     posts from a tag page readers can reach, and the `post_tags` rows would
 *     cascade away with no record they existed.
 *
 *   - An alias must not shadow a tag. `resolve_tag_slug` checks aliases first,
 *     so a tag created with a slug that is already somebody's alias would exist
 *     invisibly while `/tags/<slug>` rendered a different tag.
 *
 * Everything runs against throwaway tags with randomised slugs, deleted at the
 * end. The real taxonomy is only read.
 *
 *   node --env-file=.env.local --import ./scripts/auth/register-loader.mjs \
 *     scripts/studio/tags-test.mjs
 */

import { randomBytes } from "node:crypto";

const {
  addAlias,
  createTag,
  deleteTag,
  listTagsForStudio,
  removeAlias,
  renameTag,
  reorderTags,
  updateTag,
} = await import("../../src/lib/studio/tags-write.js");
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
const created = [];

/** `resolve_tag_slug()` is what the tag page calls; asserting against it is
 *  asserting that the change is visible to a READER, not just to this module. */
async function resolve(slug) {
  const { rows } = await pool.query(
    `SELECT resolve_tag_slug($1) AS slug, tag_is_known($1) AS known`,
    [slug]
  );
  return rows[0]?.known ? rows[0].slug : null;
}

try {
  // ── create ───────────────────────────────────────────────────────────────
  const first = await createTag({
    slug: `TestTag${runId}`,
    label: `测试标签 ${runId}`,
  });
  ok("create: succeeds", first.ok, JSON.stringify(first));
  created.push(first.id);
  eq("create: slug preserved", first.slug, `TestTag${runId}`);

  // Lowercase would break the taxonomy: every canonical slug is capitalised and
  // `/tags/<Slug>` matching is case-sensitive.
  eq("create: case is preserved", await resolve(`TestTag${runId}`), `TestTag${runId}`);

  const duplicate = await createTag({ slug: `TestTag${runId}`, label: "重复" });
  ok("create: a duplicate slug is refused", !duplicate.ok);
  eq("create: with the right reason", duplicate.reason, "duplicate");

  const empty = await createTag({ slug: "", label: "" });
  eq("create: an empty slug is refused", empty.reason, "invalid_slug");

  // ── update the label ─────────────────────────────────────────────────────
  const renamed = await updateTag(first.id, { label: `改名 ${runId}` });
  ok("update: the label changes", renamed.ok);

  const rows = await listTagsForStudio();
  const row = rows.find((t) => t.id === first.id);
  eq("update: the new label is read back", row.label, `改名 ${runId}`);
  eq(
    "update: the slug did NOT change with the label",
    row.slug,
    `TestTag${runId}`,
    "editing a display name must not move a public URL"
  );

  // ── rename: the alias is the whole point ─────────────────────────────────
  const nextSlug = `TestRenamed${runId}`;
  const rename = await renameTag(first.id, nextSlug);
  ok("rename: succeeds", rename.ok, JSON.stringify(rename));
  eq("rename: reports the previous slug", rename.previous, `TestTag${runId}`);

  eq(
    "rename: the new slug resolves",
    await resolve(nextSlug),
    nextSlug,
    "the tag page would 404 on its own new URL"
  );
  eq(
    "rename: the OLD slug still resolves to the tag",
    await resolve(`TestTag${runId}`),
    nextSlug,
    "inbound links to the retired URL would 404"
  );

  const aliasRow = rows.find((t) => t.id === first.id);
  ok("rename: the alias is visible to the studio", Boolean(aliasRow));

  const after = (await listTagsForStudio()).find((t) => t.id === first.id);
  ok(
    "rename: the old slug is listed as an alias",
    after.aliases.includes(`TestTag${runId}`),
    JSON.stringify(after.aliases)
  );

  // A→B→A must leave one alias pointing where the tag is, not a chain the
  // resolver would have to walk.
  await renameTag(first.id, `TestTag${runId}`);
  eq("rename back: the slug resolves", await resolve(`TestTag${runId}`), `TestTag${runId}`);
  eq(
    "rename back: the intermediate slug still resolves",
    await resolve(nextSlug),
    `TestTag${runId}`
  );

  // ── an alias may not shadow a tag ────────────────────────────────────────
  //
  // `resolve_tag_slug` checks aliases FIRST, so a tag whose slug is already
  // somebody's alias would exist in the studio and never be reachable.
  const second = await createTag({ slug: `TestOther${runId}`, label: "另一个" });
  created.push(second.id);

  const shadow = await createTag({ slug: nextSlug, label: "抢占别名" });
  ok("create: a slug that is an alias is refused", !shadow.ok);
  eq("create: with the alias reason", shadow.reason, "alias_conflict");

  // ── deletion ─────────────────────────────────────────────────────────────
  ok(
    "delete: an unused tag deletes",
    (await deleteTag(second.id)).ok
  );
  ok(
    "delete: an already-deleted tag reports not_found",
    (await deleteTag(second.id)).reason === "not_found"
  );

  // A tag in use is refused — asserted against the real taxonomy, which has 15
  // tags each attached to published posts.
  const inUse = (await listTagsForStudio()).find((t) => t.total_posts > 0);
  ok("the taxonomy has a tag in use", Boolean(inUse));
  const refused = await deleteTag(inUse.id);
  ok("delete: a tag in use is refused", !refused.ok);
  eq("delete: with the in_use reason", refused.reason, "in_use");
  ok("delete: the refusal carries the count", refused.count > 0, `${refused.count}`);
  eq(
    "delete: and the tag is still there",
    Boolean((await listTagsForStudio()).find((t) => t.id === inUse.id)),
    true
  );

  // ── aliases ──────────────────────────────────────────────────────────────
  const manualAlias = `TestAlias${runId}`;
  ok("alias: add succeeds", (await addAlias(first.id, manualAlias)).ok);
  eq("alias: the alias resolves", await resolve(manualAlias), `TestTag${runId}`);

  ok("alias: remove succeeds", (await removeAlias(manualAlias)).ok);
  eq("alias: the alias no longer resolves", await resolve(manualAlias), null);

  // ── reordering ───────────────────────────────────────────────────────────
  const all = await listTagsForStudio();
  const ids = all.map((t) => t.id).reverse();
  ok("reorder: succeeds", (await reorderTags(ids)).ok);

  const { rows: orderRows } = await pool.query(
    `SELECT id, sort_order FROM tags WHERE id = ANY($1::uuid[])`,
    [ids]
  );
  const byId = new Map(orderRows.map((r) => [r.id, r.sort_order]));
  eq("reorder: the first id got position 0", byId.get(ids[0]), 0);
  eq("reorder: the second id got position 1", byId.get(ids[1]), 1);

  // Put the real taxonomy back. `reorderTags` just rewrote /blog's sidebar
  // order, and the e2e suite compares the site against production.
  const original = all.map((t) => t.id);
  await reorderTags(original);
  const { rows: restored } = await pool.query(
    `SELECT id FROM tags ORDER BY sort_order, slug`
  );
  eq(
    "reorder: the original order was restored",
    restored.map((r) => r.id).join(),
    original.join()
  );

  eq("reorder: an empty list is refused", (await reorderTags([])).reason, "empty");
} catch (err) {
  failures.push(`threw: ${err.message}\n${err.stack}`);
} finally {
  // The throwaway tags and any alias they created. `tag_aliases` cascades.
  for (const id of created) {
    await pool.query(`DELETE FROM tags WHERE id = $1`, [id]).catch(() => {});
  }
  await pool
    .query(`DELETE FROM tags WHERE slug LIKE 'Test%' AND slug LIKE $1`, [`%${runId}%`])
    .catch(() => {});

  const { rows: leftover } = await pool
    .query(`SELECT count(*)::int AS n FROM tags WHERE slug LIKE $1`, [`%${runId}%`])
    .catch(() => ({ rows: [{ n: 0 }] }));
  ok("cleanup: no throwaway tags remain", leftover[0].n === 0);

  // The real taxonomy must still be intact — 15 tags, its original order.
  const { rows: real } = await pool
    .query(`SELECT count(*)::int AS n FROM tags`)
    .catch(() => ({ rows: [{ n: 0 }] }));
  eq("cleanup: the real taxonomy is intact", real[0].n, 15);

  await pool.end().catch(() => {});
}

console.log(`\nassertions: ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`\n  FAIL  ${f}`);
  process.exitCode = 1;
} else {
  console.log("OK — the taxonomy write path behaves as documented.");
}
