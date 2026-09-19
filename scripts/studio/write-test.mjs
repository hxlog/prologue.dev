#!/usr/bin/env node
/**
 * Write-path integration test, against the real database.
 *
 * The studio's write paths have properties that a build cannot check and that
 * are expensive to discover in production:
 *
 *   - Saving a post that has never been edited must materialise a draft, not
 *     write through to the published revision. Every imported post starts with
 *     no draft at all, so this is the FIRST thing that happens to all 63.
 *   - Autosave must update an unpublished draft in place. If it appended a
 *     revision instead, the history would grow once per keystroke-batch and
 *     become useless.
 *   - Publishing must move the pointer WITHOUT destroying the draft, so the
 *     next save appends rather than mutating published history.
 *   - Restoring an old revision must COPY it, never move the pointer back —
 *     otherwise the version restored FROM stops existing.
 *   - A no-op save must write nothing at all.
 *
 * These are the same properties the earlier auth harness proved for the auth
 * layer, and they are checked the same way: on a real database, in a real
 * transaction, with the result asserted rather than assumed.
 *
 * Everything runs against a throwaway post which is deleted at the end, so the
 * corpus is never touched. `--keep` skips the cleanup, for inspecting state
 * after a failure.
 *
 *   node --env-file=.env.local --import ./scripts/auth/register-loader.mjs \
 *     scripts/studio/write-test.mjs
 */

import { randomBytes } from "node:crypto";

const { createPost, getPostForEdit, savePost, publishPost, unpublishPost,
        restoreRevision, listRevisions, getRevision, deletePost, changeSlug } =
  await import("../../src/lib/studio/posts-write.js");
const { diffDocuments } = await import("../../src/lib/studio/diff.js");
const { readMeta } = await import("../../src/lib/studio/frontmatter-doc.js");
const { pool, queryOne, queryMany } = await import("../../src/lib/db/index.js");

let pass = 0;
const failures = [];

function ok(name, condition, detail = "") {
  if (condition) {
    pass++;
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function eq(name, actual, expected) {
  ok(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const runId = randomBytes(4).toString("hex");
let slug = null;

try {
  // ── create ───────────────────────────────────────────────────────────────
  const created = await createPost({ title: `write test ${runId}` });
  slug = created.slug;
  ok("create: returns a slug", typeof slug === "string" && slug.length > 0, slug);

  let row = await getPostForEdit(slug);
  ok("create: draft pointer is set", Boolean(row.draft_revision_id));
  ok("create: no published pointer yet", row.published_revision_id === null);
  eq("create: status is draft", row.status, "draft");
  eq("create: revision number is 1", row.revision_number, 1);

  // ── save a no-op: nothing must be written ────────────────────────────────
  const before = await queryOne(
    `SELECT content_hash, revision_number FROM post_revisions WHERE post_id = $1`,
    [row.id]
  );
  const noop = await savePost(slug, {
    markdown: row.markdown,
    meta: readMeta(row.markdown),
  });
  eq("no-op save: reports no change", noop.changed, false);
  eq("no-op save: same revision", noop.revisionNumber, before.revision_number);

  // ── a real edit updates the draft IN PLACE ───────────────────────────────
  const markdown = `${row.markdown}\n## 前言\n\n这是测试正文。\n`;
  const saved = await savePost(slug, {
    markdown,
    meta: { ...readMeta(markdown), title: `write test ${runId} edited` },
  });

  eq("save: reports a change", saved.changed, true);
  eq("save: still revision 1 (in place, not appended)", saved.revisionNumber, 1);

  row = await getPostForEdit(slug);
  eq("save: title landed on the revision", row.title, `write test ${runId} edited`);
  ok("save: rendered html is non-empty", String(row.html).length > 0);
  eq("save: revision count is still 1", (await listRevisions(row.id)).length, 1);
  ok(
    "save: frontmatter carries the new title",
    /^title:\s*"write test/.test(row.markdown.split("\n")[1]),
    row.markdown.split("\n").slice(0, 3).join(" | ")
  );

  // ── publish ──────────────────────────────────────────────────────────────
  const published = await publishPost(slug, {});
  eq("publish: ok", published.ok, true);
  eq("publish: first publication reports itself as such", published.firstPublication, true);

  row = await getPostForEdit(slug);
  eq("publish: status is published", row.status, "published");
  eq(
    "publish: both pointers agree (the draft is now frozen)",
    row.draft_revision_id,
    row.published_revision_id
  );
  ok("publish: published_at is set", row.published_at !== null);

  // Publishing twice is a no-op, and must SAY so rather than pretend.
  const again = await publishPost(slug, {});
  eq("publish: a second publish reports no_changes", again.reason, "no_changes");

  // ── a save after publishing appends a NEW revision ───────────────────────
  const afterPublish = await savePost(slug, {
    markdown: `${row.markdown}\n再来一段。\n`,
    meta: readMeta(row.markdown),
  });
  eq("post-publish save: appends a revision", afterPublish.revisionNumber, 2);

  row = await getPostForEdit(slug);
  ok(
    "post-publish save: the published revision is untouched",
    row.draft_revision_id !== row.published_revision_id
  );
  const publishedRev = await getRevision(row.id, row.published_revision_id);
  ok(
    "post-publish save: published revision still lacks the new paragraph",
    !publishedRev.markdown.includes("再来一段")
  );

  // ── revert ───────────────────────────────────────────────────────────────
  const revisions = await listRevisions(row.id);
  eq("history: two revisions", revisions.length, 2);

  const oldest = revisions.find((r) => r.revision_number === 1);
  const restored = await restoreRevision(slug, oldest.id, {});
  eq("restore: ok", restored.ok, true);
  eq("restore: creates a THIRD revision rather than moving the pointer", restored.revisionNumber, 3);

  row = await getPostForEdit(slug);
  eq("restore: revision 1 still exists", (await getRevision(row.id, oldest.id)).revision_number, 1);
  eq("restore: the draft is now r3", row.revision_number, 3);
  ok(
    "restore: the restored body matches r1",
    !row.markdown.includes("再来一段")
  );

  // ── the diff an author would actually read ───────────────────────────────
  const r1 = await getRevision(row.id, oldest.id);
  const r2 = await getRevision(row.id, revisions.find((r) => r.revision_number === 2).id);
  const diff = diffDocuments(r1.markdown, r2.markdown);
  ok("diff: reports the added paragraph", diff.stats.added > 0, JSON.stringify(diff.stats));
  ok("diff: does not report the whole document as rewritten", diff.stats.removed < 10, JSON.stringify(diff.stats));

  // ── unpublish ────────────────────────────────────────────────────────────
  const unpublished = await unpublishPost(slug);
  eq("unpublish: ok", unpublished.ok, true);
  row = await getPostForEdit(slug);
  eq("unpublish: status back to draft", row.status, "draft");

  // ── slug change records history ──────────────────────────────────────────
  const nextSlug = `${slug}-renamed`;
  const renamed = await changeSlug(slug, nextSlug, {});
  eq("rename: ok", renamed.ok, true);
  eq("rename: new slug", renamed.slug, nextSlug);

  const history = await queryMany(
    `SELECT slug FROM slug_history WHERE post_id = $1`,
    [row.id]
  );
  eq("rename: the old slug is recorded for a redirect", history.length, 1);
  eq("rename: recorded value is the old slug", history[0].slug, slug);
  slug = nextSlug;

  // ── concurrent save: the row lock must serialise them ────────────────────
  const concurrent = await Promise.allSettled([
    savePost(slug, { markdown: `${row.markdown}\nA\n`, meta: readMeta(row.markdown) }),
    savePost(slug, { markdown: `${row.markdown}\nB\n`, meta: readMeta(row.markdown) }),
  ]);
  const fulfilled = concurrent.filter((r) => r.status === "fulfilled").length;
  eq("concurrency: both writers either succeed or fail cleanly", fulfilled >= 1, true);

  const finalRevisions = await listRevisions(row.id);
  const numbers = finalRevisions.map((r) => r.revision_number);
  eq(
    "concurrency: no duplicate revision numbers",
    new Set(numbers).size,
    numbers.length
  );
} catch (err) {
  failures.push(`threw: ${err.message}\n${err.stack}`);
} finally {
  if (slug && !process.argv.includes("--keep")) {
    await deletePost(slug).catch(() => {});
    await deletePost(slug.replace(/-renamed$/, "")).catch(() => {});
  }
  await pool.end();
}

console.log(`assertions: ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`\n  FAIL  ${f}`);
  process.exitCode = 1;
} else {
  console.log("OK — the post write path behaves as documented.");
}
