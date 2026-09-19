/**
 * The media library's writes.
 *
 * ## Upload is three steps, and the middle one happens in the browser
 *
 *   1. `beginUpload` — the server decides the pathname, checks the declared type
 *      and size against the allowlist, and returns a presigned PUT.
 *   2. the browser PUTs the bytes straight to the store. They never touch a
 *      function: a 12 MB photo through a serverless body limit is either refused
 *      or a slow, expensive request, and the point of a presigned URL is that
 *      this leg does not exist.
 *   3. `commitUpload` — the server asks the store whether the object is actually
 *      there, and only then writes the row.
 *
 * Step 3 is the one that is easy to skip and belongs anyway. The row is what the
 * library screen shows and what the proxy checks; a row written optimistically
 * at step 1 would leave a grid full of broken thumbnails the first time a
 * browser tab was closed mid-upload. Confirming with `head()` costs one request
 * per upload and makes the database unable to claim something the store does not
 * have.
 *
 * ## Delete refuses while the bytes are in use
 *
 * Same shape as a tag in use, and the same reason: deleting an object that a
 * published post references replaces an image with a broken icon and tells
 * nobody which post to fix. The refusal carries the counts — see `usage.js`,
 * which searches the rendered HTML of posts, the markdown of pages, the JSONB
 * of collection entries and the `posts.cover_image` column, four stores that
 * keep the URL in four different shapes.
 *
 * ## Why nothing here imports `next/cache`
 *
 * Cache invalidation belongs to the Server Action that calls these functions,
 * not to the functions themselves. The reason is the same one `posts-write.js`
 * records: `updateTag` only works inside an action, so a call from here would
 * fail at runtime with an error that names the tag rather than the call site.
 * Keeping it out also means this module is plain Node, which is how
 * `scripts/studio/media-test.mjs` exercises it against the real database and the
 * real store.
 */

import { query, queryOne } from "../db";
import { createUploadTicket, deleteObject, headObject } from "./blob";
import {
  ALLOWED_TYPES,
  MAX_UPLOAD_BYTES,
  isMediaPathname,
  newPathname,
} from "./paths";
import { normaliseMedia } from "./rows";
import { usageFor } from "./usage";

export { usageFor };

/**
 * Step 1: a ticket for one object.
 *
 * The declared `contentType` is checked against the allowlist HERE, and again by
 * the CDN as part of the signed constraints. Both, not one: this check produces a
 * legible refusal before anything is uploaded, and the CDN's is the one a client
 * cannot edit out of the request.
 *
 * The size check is the same pair. A declared size over the limit is refused
 * now; a real body over the limit is refused at storage, because the signature
 * carries `maximumSizeInBytes` and the CDN enforces it.
 */
export async function beginUpload({ filename, contentType, size }) {
  const mime = String(contentType ?? "").toLowerCase();
  if (!ALLOWED_TYPES[mime]) {
    return { ok: false, reason: "unsupported_type", allowed: Object.keys(ALLOWED_TYPES) };
  }

  const bytes = Number(size);
  if (Number.isFinite(bytes) && bytes > MAX_UPLOAD_BYTES) {
    return { ok: false, reason: "too_large", maxBytes: MAX_UPLOAD_BYTES };
  }

  const pathname = newPathname(filename, mime, new Date());

  const ticket = await createUploadTicket({
    pathname,
    contentType: mime,
    maxBytes: MAX_UPLOAD_BYTES,
    // Two minutes. Long enough for a phone on a slow connection to start the
    // transfer, short enough that a leaked URL is worth little — and the URL can
    // only ever PUT one pathname, which does not exist yet and cannot be
    // overwritten.
    validUntil: Date.now() + 2 * 60 * 1000,
  });

  return {
    ok: true,
    pathname,
    presignedUrl: ticket.presignedUrl,
    expiresAt: ticket.expiresAt,
    originalName: String(filename ?? "").slice(0, 300),
  };
}

/**
 * Step 3: record an object that is now in the store.
 *
 * `head()` first. It is the difference between a library whose rows are facts and
 * one whose rows are intentions.
 *
 * `width`/`height` come from the client, measured in the browser before the
 * upload with `createImageBitmap`. They are display metadata — used to reserve
 * the right box in the grid so the page does not jump as thumbnails arrive — and
 * a wrong value is a cosmetic bug rather than a correctness one, which is why
 * reading them does not warrant pulling `sharp` into the server bundle. They are
 * still range-checked: a zero or a negative would divide by zero in the aspect
 * ratio, and `null` is the honest value for "unknown".
 */
export async function commitUpload({
  pathname,
  originalName,
  contentType,
  size,
  width,
  height,
  alt,
}) {
  if (!isMediaPathname(pathname)) return { ok: false, reason: "invalid_pathname" };

  // `head`, not `get`: the commit needs the size and the content type and
  // nothing else, and `get` would open a read stream nobody drains.
  const meta = await headObject(pathname);
  if (!meta) return { ok: false, reason: "not_uploaded" };

  const mime = String(meta.contentType ?? contentType ?? "").toLowerCase();
  if (!ALLOWED_TYPES[mime]) {
    // The object landed but is not a type we serve. Remove it rather than leave
    // an orphan in the store that nothing will ever list or clean up.
    await deleteObject(pathname).catch(() => {});
    return { ok: false, reason: "unsupported_type" };
  }

  const row = await queryOne(
    `INSERT INTO media (pathname, original_name, mime_type, size_bytes, width, height, alt)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (pathname) DO UPDATE
       SET original_name = EXCLUDED.original_name
     RETURNING id, pathname, original_name, mime_type, size_bytes, width, height, alt, caption, created_at`,
    [
      pathname,
      String(originalName ?? "").slice(0, 300),
      mime,
      Number.isFinite(Number(meta.size)) ? Number(meta.size) : Number(size) || null,
      positiveInt(width),
      positiveInt(height),
      orNull(alt),
    ]
  );

  return { ok: true, media: normaliseMedia(row) };
}

/** Alt text and caption. The two fields an author actually edits after upload. */
export async function updateMedia(id, changes) {
  const sets = [];
  const params = [id];

  for (const [column, value] of [
    ["alt", changes.alt === undefined ? undefined : orNull(changes.alt)],
    ["caption", changes.caption === undefined ? undefined : orNull(changes.caption)],
  ]) {
    if (value === undefined) continue;
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  }

  if (!sets.length) return { ok: false, reason: "nothing_to_update" };

  const row = await queryOne(
    `UPDATE media SET ${sets.join(", ")} WHERE id = $1
     RETURNING id, pathname, original_name, mime_type, size_bytes, width, height, alt, caption, created_at`,
    params
  );
  if (!row) return { ok: false, reason: "not_found" };

  return { ok: true, media: normaliseMedia(row) };
}

/**
 * Remove an object and its row.
 *
 * Refused while anything references the URL. `force` exists for the case where
 * the author has already dealt with the references and the count is stale — the
 * caller is responsible for having shown them the number, which is exactly what
 * `scripts/studio/media-test.mjs` asserts the refusal carries.
 *
 * The store is deleted FIRST. If the row went first and `del` failed, the object
 * would be unattached to a row and therefore invisible to every screen —
 * unreachable, unbilled for nothing, and impossible to find later. Dying the
 * other way leaves a row pointing at a missing object: visible, reportable, and
 * fixable by re-uploading.
 */
export async function deleteMedia(id, { force = false } = {}) {
  const row = await queryOne(`SELECT id, pathname FROM media WHERE id = $1`, [id]);
  if (!row) return { ok: false, reason: "not_found" };

  const usage = await usageFor(row.pathname);
  if (usage.total > 0 && !force) {
    return { ok: false, reason: "in_use", ...usage, pathname: row.pathname };
  }

  try {
    await deleteObject(row.pathname);
  } catch (err) {
    // Already gone is a success: the post-condition is "no object at this
    // pathname", and a second delete of the same row is a real case.
    if (!/not.?found/i.test(err?.message ?? "")) throw err;
  }

  await query(`DELETE FROM media WHERE id = $1`, [id]);
  return { ok: true, pathname: row.pathname };
}

/**
 * Is this pathname referenced?
 *
 * The check lives in `usage.js` and is re-exported here so a caller reading the
 * delete path does not have to know there is another module — but it is
 * imported rather than defined here because the /api/img proxy asks the SAME
 * question with different filters (published only). Two implementations of "is
 * this object referenced" is a state where a delete and a serve disagree, which
 * is exactly how a published page ends up with a broken image.
 */

function positiveInt(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n < 100_000 ? Math.round(n) : null;
}

function orNull(value) {
  const text = value === null || value === undefined ? "" : String(value).trim();
  return text === "" ? null : text.slice(0, 2000);
}
