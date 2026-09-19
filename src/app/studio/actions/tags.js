/**
 * Taxonomy actions: what the tags screen calls.
 *
 * The taxonomy is 15 tags that arrived from the static site, and until now
 * nothing could change it without an import — the read path has been
 * database-backed for a while, but the list itself was fixed. This is the write
 * side of that.
 *
 * ## Why a rename is the dangerous one
 *
 * `/tags/<slug>` is a public URL. `renameTag` writes the old slug into
 * `tag_aliases` in the same transaction, and `resolve_tag_slug()` — which the
 * tag page has always called — keeps the old URL working. The two writes are
 * one transaction because there is no useful state between them: a rename
 * without the alias is a 404 for every inbound link, and an alias without the
 * rename points a URL at itself.
 *
 * ## What is invalidated, and what deliberately is not
 *
 * `tags` is the taxonomy's own tag: labels, aliases, counts. It is bumped on
 * every write here. `posts` is NOT — editing a tag's label does not change a
 * single byte of any post, and bumping the post cache would rebuild the entire
 * archive because someone fixed a typo in a Chinese name.
 */

"use server";

import { revalidatePath, updateTag } from "next/cache";

import { requireUser } from "../../../lib/auth/require";
import {
  addAlias,
  createTag,
  deleteTag,
  listTagsForStudio,
  removeAlias,
  renameTag,
  reorderTags,
  updateTag as updateTagRow,
} from "../../../lib/studio/tags-write";
import { TAGS } from "../../../lib/studio/cache-tags";

export async function listTagsAction() {
  await requireUser();
  return { ok: true, tags: await listTagsForStudio() };
}
export async function createTagAction(input) {
  await requireUser();
  const result = await createTag(input ?? {});
  if (result.ok) invalidateTaxonomy();
  return result;
}

export async function updateTagAction(id, changes) {
  await requireUser();
  const result = await updateTagRow(id, changes ?? {});
  if (result.ok) invalidateTaxonomy();
  return result;
}

/**
 * Rename a tag's slug.
 *
 * The alias is written by `renameTag` itself, in the same transaction, so this
 * has nothing to add but the invalidation — and `tags` covers the resolver,
 * because `resolveTagSlug` is cached under it.
 */
export async function renameTagAction(id, nextSlug) {
  await requireUser();
  const result = await renameTag(id, nextSlug);
  if (result.ok && !result.unchanged) {
    invalidateTaxonomy();
    revalidatePath(`/tags/${result.previous}`);
    revalidatePath(`/tags/${result.slug}`);
  }
  return result;
}

export async function addAliasAction(tagId, aliasSlug) {
  await requireUser();
  const result = await addAlias(tagId, aliasSlug);
  if (result.ok) {
    invalidateTaxonomy();
    revalidatePath(`/tags/${result.slug}`);
  }
  return result;
}

export async function removeAliasAction(aliasSlug) {
  await requireUser();
  const result = await removeAlias(aliasSlug);
  if (result.ok) invalidateTaxonomy();
  return result;
}

/**
 * Delete a tag.
 *
 * Refused while any post uses it, and the refusal carries the count so the
 * screen can say how many. `force` is only reachable from a second confirmation
 * that has already shown that number.
 */
export async function deleteTagAction(id, force = false) {
  await requireUser();
  const result = await deleteTag(id, { force: force === true });
  if (result.ok) {
    updateTag(TAGS.tags);
    // The search index holds a denormalised copy of each post's tags, and
    // `deleteTag` strips the slug out of it. That is a change to a search row,
    // so the search cache goes with it.
    updateTag(TAGS.search);
    revalidatePath("/blog");
  }
  return result;
}

export async function reorderTagsAction(ids) {
  await requireUser();
  const result = await reorderTags(ids ?? []);
  if (result.ok) {
    invalidateTaxonomy();
    revalidatePath("/blog");
  }
  return result;
}

/**
 * Drop the taxonomy cache.
 *
 * `TAGS.tags` and nothing else. A tag write changes which tags exist and what
 * they are called; it does not change a post's HTML, its date or its
 * publication state, so bumping `posts` here would rebuild every post page and
 * the whole archive to reflect a change that none of them contain.
 */
function invalidateTaxonomy() {
  updateTag(TAGS.tags);
  revalidatePath("/studio/tags");
}
