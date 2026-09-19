/**
 * Navigation actions: what the header editor calls.
 *
 * Thin by design — every one of these checks the session, calls a write in
 * src/lib/studio/nav.js, and lets that module invalidate the `nav` tag. There
 * is no revalidation logic here because there is nothing else to invalidate:
 * the nav appears in the site layout and nowhere else, and the layout's only
 * nav read is tagged `nav`.
 *
 * ## Why a route can be added but not created
 *
 * `/blog` is a file in `src/app/(site)/blog`, not a row anywhere. The nav
 * editor will happily link to it, and to `/microblog`, `/links`, `/tags` — but
 * it does not create them, and a nav entry pointing at a route that does not
 * exist is a 404 the author typed deliberately. That is their call to make; the
 * job here is to not make it silently. `external: true` marks a link that
 * leaves the site, so the renderer can add `target="_blank"` and the author can
 * see at a glance which entries do not stay.
 */

"use server";

import { requireUser } from "../../../lib/auth/require";
import {
  createNavItem,
  deleteNavItem,
  reorderNavItems,
  updateNavItem,
} from "../../../lib/studio/nav";

/**
 * No `revalidatePath` anywhere in this file.
 *
 * The nav appears in the site layout and in the editor on /studio/nav, and the
 * `nav` tag is dropped by the write itself (src/lib/studio/nav.js). The editor
 * page is a blocking route — it reads a session — so it is re-rendered on the
 * next request regardless, and adding a path revalidation would be a second
 * mechanism for something the tag already does.
 *
 * Each action returns the write's own result rather than a status of its own,
 * so the client sees the specific reason (`invalid`, `not_found`) rather than
 * a generic failure.
 */

export async function createNavItemAction(input) {
  await requireUser();
  return createNavItem(input ?? {});
}

export async function updateNavItemAction(id, changes) {
  await requireUser();
  return updateNavItem(id, changes ?? {});
}

export async function deleteNavItemAction(id) {
  await requireUser();
  return deleteNavItem(id);
}

export async function reorderNavItemsAction(ids) {
  await requireUser();
  return reorderNavItems(ids ?? []);
}
