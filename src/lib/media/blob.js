/**
 * The only module that talks to Vercel Blob.
 *
 * ## Why the store is private and why that is not paranoia
 *
 * Every image this site has ever carried is a public file under `public/`, and
 * that is exactly the problem: a public Blob store is a bucket anybody can
 * enumerate, and the moment the library is writable from the studio, "anybody
 * can list everything ever uploaded, including the drafts and the screenshots of
 * things that were never published" becomes true. A private store plus this
 * module's own proxy route makes the URL a capability we issue rather than one
 * the provider hands out.
 *
 * Verified against the real store before this was written — see
 * `scripts/studio/blob-probe.mjs`, which asserts that an unauthenticated fetch of
 * a raw blob URL answers **403**. That check is worth keeping runnable because
 * `access: 'private'` is a per-call argument: the same code against a public
 * store would succeed and serve the object to the world.
 *
 * ## `access` is mandatory, not defaulted
 *
 * In SDK 2.8.0 the `access` option has no default and omitting it throws. It is
 * spelled out at every call site here rather than hoisted into a constant, so
 * that grepping for `access: "private"` finds every read and write against the
 * store.
 *
 * ## Reads go through `contentType` from our own row, not from Blob
 *
 * `get()` returns the stored content type, and for the proxy we trust it — but
 * we also set it explicitly at upload, from an allowlist, in `paths.js`. The
 * pair matters because a content type that arrived from the client would be an
 * XSS primitive: `text/html` served from our origin is a page, not an image.
 */

import { issueSignedToken, presignUrl, put, get, head, del, list } from "@vercel/blob";

/** Everything under this prefix is the studio's library. Anything else in the
 *  store is somebody else's business and is never listed or deleted here. */
export const MEDIA_PREFIX = "media/";

/**
 * A presigned PUT for the browser to upload directly to.
 *
 * The bytes never pass through a function. A 12 MB photo through a serverless
 * body limit is either rejected or a slow, expensive request, and the whole
 * point of a presigned URL is that the transfer goes browser → store directly.
 * The server's role is to decide the pathname and the constraints, which is what
 * `issueSignedToken` + `presignUrl` encode.
 *
 * The constraints are enforced by the CDN, not by us: `allowedContentTypes` and
 * `maximumSizeInBytes` are part of the signature, so a client that edits the
 * request cannot get the store to hold something the server did not agree to.
 * What "enforced" means differs per constraint and the difference is not
 * obvious, so it is spelled out below rather than assumed. `allowOverwrite` is
 * off — a pathname is generated fresh per upload and a collision would mean two
 * different images claiming one URL.
 *
 * `access: 'private'` is stated twice on purpose: once as the delegation's scope
 * and once as the presign's, because they are separate arguments and only the
 * second one is the one the CDN checks.
 *
 * ## What the signature actually pins, measured
 *
 * `scripts/studio/blob-signing-probe.mjs` asks the store four questions, and the
 * answers are the security posture of this whole path. Run on 2.8.0 against the
 * real store:
 *
 *   - `addRandomSuffix` defaults to FALSE, on `put()` and on `presignUrl()`
 *     alike. It is still set explicitly below, because the value matters and a
 *     default is not a promise — but this file previously claimed the opposite
 *     and cited a measurement that does not reproduce. The probe is what
 *     settled it; the comment now records the probe, not a story about one.
 *
 *   - A client that swaps the PATHNAME in a presigned URL is refused with 403.
 *     The pathname is part of the signed query, so a ticket is a ticket for one
 *     object and not a skeleton key for the store.
 *
 *   - A body over `maximumSizeInBytes` is refused with 403.
 *
 *   - A client that sends a Content-Type OUTSIDE `allowedContentTypes` is
 *     ACCEPTED with 200 — and the object is stored with the content type the
 *     signature declared, not the one the client sent. The constraint is
 *     enforced by overriding rather than by rejecting, which is the safe half of
 *     those two options but not the half a reader would assume. This is why
 *     `commitUpload` re-reads the type with `head()` instead of trusting the
 *     request, and why the proxy sends `nosniff`.
 *
 * `allowOverwrite` is off for the same reason a pathname is generated fresh per
 * upload: a collision would mean two different images claiming one URL.
 */
export async function createUploadTicket({ pathname, contentType, maxBytes, validUntil }) {
  const signed = await issueSignedToken({
    pathname,
    operations: ["put"],
    allowedContentTypes: [contentType],
    maximumSizeInBytes: maxBytes,
    validUntil,
  });

  const { presignedUrl } = await presignUrl(signed, {
    operation: "put",
    pathname,
    access: "private",
    allowedContentTypes: [contentType],
    maximumSizeInBytes: maxBytes,
    allowOverwrite: false,
    addRandomSuffix: false,
  });

  return { presignedUrl, expiresAt: signed.validUntil };
}

/**
 * Server-side write, for objects the app generates rather than receives.
 *
 * `allowOverwrite: false` for the same reason as above, and because the SDK's
 * default is TRUE — an accidental re-put would silently replace bytes at a URL
 * that is already in a published post's markdown.
 */
export async function putObject({ pathname, body, contentType }) {
  return put(pathname, body, {
    access: "private",
    contentType,
    addRandomSuffix: false,
    allowOverwrite: false,
  });
}

/**
 * Stream an object back.
 *
 * Returns the stream and the stored metadata, or null when the object is gone.
 * `useCache` is left at its default: the pathname includes a random component
 * and is never overwritten, so an object at a given pathname is immutable and
 * the CDN's copy is always correct.
 */
export async function getObject(pathname) {
  return get(pathname, { access: "private" });
}

export async function deleteObject(pathname) {
  await del(pathname);
}

/**
 * Ask the store what it holds.
 *
 * Used by the reconciliation script, not by the library screen — the screen
 * reads the database, because the database is where alt text and captions live
 * and a grid of images with no alt text is not a library, it is a file listing.
 * This exists so a row deleted outside the app, or a byte uploaded by a failed
 * commit, can be found and reported.
 */
export async function listStore({ prefix = MEDIA_PREFIX, cursor } = {}) {
  return list({ prefix, cursor, limit: 1000 });
}

/**
 * Does the object exist, and what is it?
 *
 * `head` rather than `get`: the commit step needs the size and the content type
 * and nothing else, and `get` would open a read stream nobody drains. One
 * request, no body.
 */
export async function headObject(pathname) {
  try {
    return await head(pathname);
  } catch {
    return null;
  }
}

/** Whether the store is configured at all. The library screen says so rather
 *  than throwing, because "no token in this environment" is a normal state for
 *  a local checkout and not a bug. */
export function blobConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}
