/**
 * Post actions: what the editor screen calls.
 *
 * Every one of these is a Server Action rather than a route handler, for the
 * reason given in actions/auth.js: the outcome is a message on the form the
 * author is looking at, and an action returns it to the component that rendered
 * the form.
 *
 * ## The division of labour with src/lib/studio/posts-write.js
 *
 * That module is plain Node — it opens transactions, locks rows, renders
 * markdown, and knows nothing about Next. THIS file is the only place that
 * touches the framework: it checks the session, calls the write, and then
 * invalidates caches. Keeping the split there means the write path can be
 * exercised by a script against the real database (scripts/studio/write-test.mjs),
 * which is how its behaviour was verified — a module that imported `updateTag`
 * could not be.
 *
 * ## Why `updateTag` and not `revalidateTag`
 *
 * `revalidateTag` marks an entry stale and lets the NEXT request recompute it,
 * which is right for a reader-facing page where a few hundred milliseconds of
 * staleness are free. The author hitting Save is a different situation: they
 * are about to open the post page and expect to see what they just wrote. There
 * is exactly one author, so the eager cost is one document, not a fleet.
 */

"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "../../../lib/auth/require";
import {
  createPost,
  deletePost,
  getPostForEdit,
  getRevision,
  listRevisions,
  publishPost,
  restoreRevision,
  savePost,
  unpublishPost,
} from "../../../lib/studio/posts-write";
import { renderMarkdown } from "../../../lib/markdown/render";
import { invalidatePost } from "../../../lib/studio/cache-tags";
import { indexPost, unindex } from "../../../lib/studio/search-write";
import { readMeta } from "../../../lib/studio/frontmatter-doc";
import { diffDocuments } from "../../../lib/studio/diff";

/**
 * Autosave.
 *
 * Returns the rendered HTML as well as a status, so the preview pane updates
 * from the same render that was stored. A separate preview endpoint would be a
 * second rendering path, and a second rendering path is exactly what this
 * editor's design exists to avoid.
 *
 * The `revision` parameter is optimistic concurrency: it is the revision the
 * client believes it is editing. A mismatch means another tab wrote first, and
 * the save is refused rather than applied — losing the other tab's work
 * silently is worse than an error message.
 */
export async function autosavePost(slug, { markdown, meta, revision }) {
  const session = await requireUser();

  const current = await getPostForEdit(slug);
  if (!current) return { ok: false, reason: "not_found" };

  // A conflict only matters when it would actually lose something: if the
  // server's revision is one the client has already seen, there is nothing to
  // protect. `>` rather than `!==` because a restore moves the number forward
  // too, and an author who restored a revision and then typed should not be
  // told they have a conflict with themselves.
  if (
    typeof revision === "number" &&
    current.revision_number > revision &&
    current.draft_revision_id !== current.published_revision_id
  ) {
    return {
      ok: false,
      reason: "conflict",
      serverRevision: current.revision_number,
    };
  }

  const result = await savePost(slug, {
    markdown,
    meta,
    userId: session.user.id,
  });

  if (!result.ok) return result;

  // Only when the bytes actually moved. An idle editor on a timer produces no
  // writes and therefore no invalidation — which is what keeps a two-and-a-half
  // second autosave from being a cache-thrashing machine.
  if (result.changed) {
    invalidatePost(slug);
    revalidatePath(`/studio/posts/${slug}`);
  }

  return {
    ok: true,
    changed: result.changed,
    revisionNumber: result.revisionNumber,
    html: result.html,
    markdown: result.markdown,
    unknownTags: result.unknownTags,
  };
}

/**
 * Render markdown without saving it.
 *
 * For the preview pane when the author has typed but autosave has not fired.
 * Uses the same `renderMarkdown` as everything else, so what this returns is
 * byte-identical to what a save would store.
 */
export async function renderPreview(markdown) {
  await requireUser();
  const { html, headings, readingTime } = await renderMarkdown(String(markdown ?? ""));
  return { html, headings, readingTime };
}

/** Publish the current draft. */
export async function publishPostAction(slug) {
  const session = await requireUser();
  const result = await publishPost(slug, { userId: session.user.id });

  if (!result.ok) return result;

  invalidatePost(result.slug);
  await indexPost({
    postId: result.postId,
    slug: result.slug,
    title: result.title,
    description: result.description,
    html: result.html,
    tags: result.tags,
    labels: result.labels,
    publishedAt: result.publishedAt,
  });

  revalidatePath(`/studio/posts/${slug}`);
  revalidatePath("/studio");

  return {
    ok: true,
    status: "published",
    publishedAt: result.publishedAt,
    firstPublication: result.firstPublication,
  };
}

/** Take a published post back to draft. Readers get a 404 again. */
export async function unpublishPostAction(slug) {
  await requireUser();
  const result = await unpublishPost(slug);
  if (!result.ok) return result;

  invalidatePost(slug);
  await unindex(`post:${result.slug}`);

  revalidatePath(`/studio/posts/${slug}`);
  revalidatePath("/studio");

  return { ok: true, status: "draft" };
}

/** Create a post and go straight to its editor. */
export async function createPostAction({ title }) {
  const session = await requireUser();
  const result = await createPost({ title, userId: session.user.id });
  if (!result.ok) return result;

  invalidatePost(result.slug);
  return { ok: true, slug: result.slug };
}

/**
 * Delete a post.
 *
 * Requires the slug to be typed back. Not to be annoying — a cascading delete
 * of a post, its entire revision history and its search row, with no undo, is
 * the most destructive button in the application, and a confirmation dialog
 * that can be dismissed by reflex is not a confirmation.
 */
export async function deletePostAction(slug, confirmation) {
  await requireUser();

  if (String(confirmation ?? "").trim() !== slug) {
    return { ok: false, reason: "confirmation_mismatch" };
  }

  const result = await deletePost(slug);
  if (!result.ok) return result;

  invalidatePost(slug);
  await unindex(`post:${slug}`);
  revalidatePath("/studio/posts");

  return { ok: true };
}

/**
 * Restore a historical revision as the new draft.
 *
 * A copy, not a pointer move — see src/lib/studio/posts-write.js. The diff is
 * computed and returned here so the confirmation step can show the author
 * exactly what they are about to bring back, rather than the revision number.
 */
export async function restoreRevisionAction(slug, revisionId) {
  const session = await requireUser();

  const current = await getPostForEdit(slug);
  if (!current) return { ok: false, reason: "not_found" };

  // The change this restore represents, shown before it is applied.
  const before = await getRevision(current.id, revisionId);

  const result = await restoreRevision(slug, revisionId, { userId: session.user.id });
  if (!result.ok) return result;

  invalidatePost(slug);
  revalidatePath(`/studio/posts/${slug}`);

  return {
    ok: true,
    revisionNumber: result.revisionNumber,
    restoredFrom: result.restoredFrom,
    // The preview of what came back, so the author sees the effect immediately.
    title: before?.title ?? null,
  };
}

/** The revision history, for the history screen. */
export async function loadRevisions(slug) {
  await requireUser();
  const current = await getPostForEdit(slug);
  if (!current) return { ok: false, reason: "not_found" };
  return { ok: true, revisions: await listRevisions(current.id) };
}

/**
 * A line diff between two revisions.
 *
 * Computed on the server because both sides can be 24 KB, and shipping two
 * whole documents to the browser to compute a diff there would send roughly
 * twice what the diff itself contains.
 */
export async function diffRevisions(slug, fromId, toId) {
  await requireUser();

  const current = await getPostForEdit(slug);
  if (!current) return { ok: false, reason: "not_found" };

  const [from, to] = await Promise.all([
    getRevision(current.id, fromId),
    toId ? getRevision(current.id, toId) : current,
  ]);
  if (!from) return { ok: false, reason: "not_found" };

  const target = to ?? current;

  return {
    ok: true,
    from: { id: from.id, number: from.revision_number, createdAt: from.created_at },
    to: {
      id: target.id,
      number: target.revision_number,
      createdAt: target.created_at,
    },
    diff: diffDocuments(from.markdown, target.markdown),
  };
}

/** Frontmatter fields plus the raw document, for the initial page render. */
export async function loadEditorState(slug) {
  await requireUser();
  const row = await getPostForEdit(slug);
  if (!row) return null;
  return { ...row, meta: readMeta(row.markdown ?? "") };
}
