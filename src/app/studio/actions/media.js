/**
 * Media actions: what the library screen calls.
 *
 * Thin over `src/lib/media/write.js`, the same shape as the nav actions — check
 * the session, then let the write module report its own reason. The one thing
 * that happens here and not there is the path revalidation, because the library
 * screen is a blocking route that reads the database directly rather than
 * through a cache tag.
 *
 * ## `instant = false` and why these are not cached
 *
 * The library is a screen one person opens to move a file or fix a caption. It
 * changes on every upload and every edit, and caching it would add an
 * invalidation to reason about in exchange for saving a query nobody would wait
 * for. See the note in `src/lib/media/library.js` for the one read that IS
 * cached — the published-media check — and why.
 */

"use server";

import { revalidatePath, updateTag } from "next/cache";

import { requireUser } from "../../../lib/auth/require";
import { countMedia, listMedia } from "../../../lib/media/library";
import {
  beginUpload,
  commitUpload,
  deleteMedia,
  updateMedia,
} from "../../../lib/media/write";
import { TAGS } from "../../../lib/studio/cache-tags";

/**
 * Drop the media cache.
 *
 * TWO things ride on this tag and they are not the same kind of thing. The
 * library listing is one. The other is `isMediaPublished` — the answer
 * `/api/img` gives a caller with no session — and the media writes below are
 * only half of what changes it. Publishing a post is the other half, which is
 * why `invalidatePost` drops this tag too. See the note on `TAGS.media`.
 */
function invalidateMedia() {
  updateTag(TAGS.media);
}

/**
 * Step 1. Returns a presigned PUT the browser uses directly.
 *
 * The response is a URL and an expiry, not an upload. Nothing has been written
 * anywhere when this returns, which is what keeps a 12 MB photo out of a
 * function's body limit.
 */
export async function beginUploadAction(input) {
  await requireUser();
  const result = await beginUpload(input ?? {});
  return result;
}

/**
 * A page of the library, for the picker.
 *
 * The library screen itself reads the database directly, because it is a
 * blocking route with a session and there is nothing to cache. The picker runs
 * inside an editor that is already open, so it needs a way to ask — and asking
 * through an action keeps ONE read path rather than a second fetch to a route
 * handler that would have to re-derive the same authorisation.
 */
export async function listMediaAction({ query: search = "", limit = 60 } = {}) {
  await requireUser();
  return {
    ok: true,
    media: await listMedia({ query: search, limit }),
    total: await countMedia({ query: search }),
  };
}

/** Step 3. The object is in the store; record it. */
export async function commitUploadAction(input) {
  await requireUser();
  const result = await commitUpload(input ?? {});
  if (result.ok) {
    invalidateMedia();
    revalidatePath("/studio/media");
  }
  return result;
}

export async function updateMediaAction(id, changes) {
  await requireUser();
  const result = await updateMedia(id, changes ?? {});
  if (result.ok) {
    invalidateMedia();
    revalidatePath("/studio/media");
  }
  return result;
}

/**
 * Delete.
 *
 * The refusal carries the usage counts so the screen can say how many posts
 * reference the file. `force` is only reachable from a second confirmation that
 * has already shown that number — the same contract as deleting a tag.
 */
export async function deleteMediaAction(id, force = false) {
  await requireUser();
  const result = await deleteMedia(id, { force: force === true });
  if (result.ok) {
    invalidateMedia();
    revalidatePath("/studio/media");
  }
  return result;
}
