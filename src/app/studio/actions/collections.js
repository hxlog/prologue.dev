/**
 * Collection actions: what the collections screens call.
 *
 * The split is the same as everywhere else in this directory. Writes live in
 * src/lib/studio/collections-write.js and are plain Node, so a script can
 * exercise them against the real database; this file checks the session and
 * invalidates caches, which is the part that needs `next/cache`.
 *
 * ## The two tags, and why they are not the same tag
 *
 * A collection's ENTRIES and its SCHEMA change independently and are read by
 * different things. Adding a field must rebuild the editor's form, but must not
 * evict `/microblog`, which renders entries and does not know the field exists.
 * Adding an entry must rebuild `/microblog`, but must not rebuild the form.
 *
 * `invalidateCollection(slug, { schema: true })` is the schema tag; the default
 * is the entry tag. Getting this wrong in either direction is invisible — just
 * a page that rebuilds more than it needs to, or a form that shows a field that
 * was deleted.
 */

"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "../../../lib/auth/require";
import {
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
} from "../../../lib/studio/collections-write";
import { invalidateCollection } from "../../../lib/studio/cache-tags";
import { indexCollectionEntry, unindex } from "../../../lib/studio/search-write";

/* ── entries ─────────────────────────────────────────────────────────────── */

/**
 * Save an entry, creating it when `entryId` is null.
 *
 * One action for both, because the form is the same form and the only
 * difference is which pointer the write ends at. The reindex happens after the
 * write and only for a PUBLISHED entry — indexing a draft would put a URL into
 * search results that the reader cannot reach.
 */
export async function saveEntryAction(slug, entryId, payload) {
  await requireUser();

  const collection = await getCollectionForEdit(slug);
  if (!collection) return { ok: false, reason: "not_found" };

  const result = entryId
    ? await updateEntry(entryId, payload ?? {})
    : await createEntry(collection.id, payload ?? {});
  if (!result.ok) return result;

  invalidateCollection(slug);
  await reindexEntry(collection, entryId ?? result.id);

  revalidatePath(`/studio/collections/${slug}`);
  return result;
}

export async function deleteEntryAction(slug, entryId) {
  await requireUser();

  const collection = await getCollectionForEdit(slug);
  const result = await deleteEntry(entryId);
  if (!result.ok) return result;

  await unindex(`entry:${collection?.id}:${entryId}`);
  invalidateCollection(slug);
  revalidatePath(`/studio/collections/${slug}`);
  return result;
}

/**
 * Publish or unpublish one entry.
 *
 * A collection entry has no revision history and no separate draft pointer —
 * unlike a post, an entry is a row, and its `status` column is the whole of the
 * publish state. That is deliberate: a microblog entry is a sentence, and
 * versioning it would be machinery for a problem that does not exist.
 */
export async function setEntryStatusAction(slug, entryId, status) {
  await requireUser();

  const collection = await getCollectionForEdit(slug);
  const result = await updateEntry(entryId, { status });
  if (!result.ok) return result;

  if (status === "published") {
    await reindexEntry(collection, entryId);
  } else {
    await unindex(`entry:${collection?.id}:${entryId}`);
  }

  invalidateCollection(slug);
  revalidatePath(`/studio/collections/${slug}`);
  return result;
}

export async function reorderEntriesAction(slug, ids) {
  await requireUser();
  const result = await reorderEntries(ids ?? []);
  if (result.ok) {
    invalidateCollection(slug);
    revalidatePath(`/studio/collections/${slug}`);
  }
  return result;
}

export async function pinEntryAction(slug, entryId, pinned) {
  await requireUser();
  const result = await setEntryPinned(entryId, pinned);
  if (result.ok) {
    invalidateCollection(slug);
    revalidatePath(`/studio/collections/${slug}`);
  }
  return result;
}

/* ── schema ──────────────────────────────────────────────────────────────── */

export async function saveFieldAction(slug, fieldId, input) {
  await requireUser();

  const collection = await getCollectionForEdit(slug);
  if (!collection) return { ok: false, reason: "not_found" };

  const result = await saveField(collection.id, input ?? {}, { fieldId });
  if (!result.ok) return result;

  invalidateCollection(slug, { schema: true });
  revalidatePath(`/studio/collections/${slug}`);
  return result;
}

/**
 * Delete a field.
 *
 * The stored values stay — see the note on `deleteField`. What does change is
 * the form, and therefore which fields the next save writes, so the schema tag
 * goes and the entry tag does not: nothing a reader sees has changed.
 */
export async function deleteFieldAction(slug, fieldId) {
  await requireUser();

  const collection = await getCollectionForEdit(slug);
  if (!collection) return { ok: false, reason: "not_found" };

  const result = await deleteField(collection.id, fieldId);
  if (!result.ok) return result;

  invalidateCollection(slug, { schema: true });
  revalidatePath(`/studio/collections/${slug}`);
  return result;
}

/* ── reads the client needs ──────────────────────────────────────────────── */

export async function loadEntriesAction(slug) {
  await requireUser();
  const collection = await getCollectionForEdit(slug);
  if (!collection) return { ok: false, reason: "not_found" };
  return { ok: true, entries: await listEntries(collection.id) };
}

export async function loadEntryAction(entryId) {
  await requireUser();
  const entry = await getEntry(entryId);
  return entry ? { ok: true, entry } : { ok: false, reason: "not_found" };
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

/**
 * Put an entry into the search index from its rendered field values.
 *
 * Only text-shaped fields are indexed. An image gallery's alt text is useful
 * but its src is not, and indexing a URL would make every search for a hostname
 * return the entry — so the text is assembled from the fields a reader would
 * actually read.
 *
 * The URL is the collection's own page with the entry's anchor, which is what
 * the microblog uses for deep links and what a searcher wants: the entry, not
 * the top of the page.
 */
async function reindexEntry(collection, entryId) {
  if (!collection) return;

  const entry = await getEntry(entryId);
  if (!entry || entry.status !== "published") return;

  const values = entry.values ?? {};
  const text = Object.entries(values)
    .filter(([, value]) => typeof value === "string" || typeof value === "number")
    .map(([, value]) => String(value))
    .join("\n");

  const title = String(values.name ?? values.title ?? values.content ?? "").slice(0, 120);

  await indexCollectionEntry({
    collectionSlug: collection.slug,
    entryId,
    title: title || collection.name,
    description: null,
    text,
    tags: [],
    publishedAt: entry.published_at,
    url: entryUrl(collection.slug, entry),
  });
}

/**
 * Where a reader would find this entry.
 *
 * A collection has no route of its own — a PAGE renders it, and which page is
 * the author's choice. The convention this site follows is that the collection
 * and its page share a slug (`microblog` → `/microblog`, `links` → `/links`),
 * which is what makes this a one-liner rather than a lookup on
 * `collections.settings`.
 *
 * The anchor is appended when there is one. For the microblog that is not
 * decoration: `/microblog#mb-20260905-24` is the entry's real address, the one
 * the RSS feed uses as a guid and the one a reader would bookmark, so a search
 * result that pointed at the top of the page would be sending them to the wrong
 * place. The friend-links collection has no anchors, and gets the page.
 */
function entryUrl(collectionSlug, entry) {
  const base = `/${collectionSlug}`;
  return entry?.anchor ? `${base}#${entry.anchor}` : base;
}
