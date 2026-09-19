/**
 * Where a media object lives in the store, and what may not.
 *
 * A pathname is the object's identity in three places at once: the Blob key, the
 * `media.pathname` column, and the tail of its public URL (`/api/img/<pathname>`).
 * It is generated here, on the server, and never taken from the client — the
 * client sends a filename and gets back a pathname it did not choose.
 *
 * ## The shape
 *
 *     media/<year>/<month>/<8 hex>-<slug>.<ext>
 *
 * The date folded into the path is so the store is browsable as a timeline
 * rather than one directory of 3000 objects. The random prefix is the part that
 * matters: it is what makes a pathname unguessable, and since the store is
 * private and served only through our own proxy, an unguessable pathname is the
 * capability a reader holds. A slug alone would be enumerable.
 *
 * ## Why the extension is derived, not copied
 *
 * The filename comes from whatever the author's camera or screenshot tool called
 * it, which is untrusted input reaching a storage key. It is slugified down to
 * `[a-z0-9-]` and the extension is looked up from the MIME type, so `../../etc`
 * or `a.jpg%00.php` cannot survive as a key. The original name is kept in the
 * database for display and search — it just never becomes a path.
 */

import { randomBytes } from "node:crypto";

/**
 * MIME types the library accepts, mapped to their canonical extension.
 *
 * An allowlist rather than a denylist, and the extension comes from HERE rather
 * than from the filename. Two reasons: the store should not become a place to
 * park arbitrary files because a single-author site has one trusted user, and a
 * `.svg` is not in this list deliberately — an SVG is a document that can carry
 * script, and serving one from the site's own origin is stored XSS against
 * anyone who opens it directly.
 */
export const ALLOWED_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
};

/** 25 MiB. Larger than any photo this site has ever carried, small enough that
 *  a mistake does not quietly cost real money in Blob storage. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** The URL prefix the proxy is mounted at. One constant, because the markdown
 *  the studio inserts, the feed's absolutiser and the proxy route all have to
 *  agree on it. */
export const MEDIA_URL_PREFIX = "/api/img";

/**
 * A pathname for a new object.
 *
 * `now` is a parameter rather than a call to `Date.now()` so the caller can pass
 * the one timestamp it already has, and so this function is pure.
 */
export function newPathname(originalName, mimeType, now) {
  const ext = ALLOWED_TYPES[mimeType];
  if (!ext) return null;

  const date = now instanceof Date ? now : new Date(now);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");

  const slug = slugifyName(originalName);
  const random = randomBytes(4).toString("hex");

  // The slug is capped so a 200-character filename cannot produce a 200-character
  // key. It is decoration on the URL; the random prefix is the identity.
  const tail = slug ? `${random}-${slug}` : random;
  return `media/${year}/${month}/${tail}.${ext}`;
}

/**
 * The name half of a filename, as a path-safe fragment.
 *
 * Deliberately drops anything that is not `[a-z0-9-]`, including CJK. A CJK
 * filename would produce percent-encoded pathnames that differ between the Blob
 * key, the database and the browser's rendering of the URL, and those three
 * disagreeing is a class of bug with no upside here — the readable name is in
 * `media.original_name` where it can actually be searched.
 */
export function slugifyName(name) {
  const base = String(name ?? "")
    .replace(/\.[^.]+$/, "") // drop the extension; it is re-derived
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base.slice(0, 60);
}

/**
 * Whether a pathname is one of ours, and safe to hand to the Blob API.
 *
 * The proxy route passes a value straight from the URL path to `get()`, so this
 * is the boundary that has to be exact. A pathname is accepted only if it
 * matches the shape `newPathname` produces — which, being a regex anchored at
 * both ends over a restricted character set, cannot express `..`, a query
 * string, an absolute URL, or a percent-encoding trick. Returning false for
 * everything else means the proxy has no fallthrough case to get wrong.
 */
const PATHNAME_RE = /^media\/\d{4}\/\d{2}\/[a-z0-9][a-z0-9-]*\.[a-z0-9]{2,5}$/;

export function isMediaPathname(value) {
  return typeof value === "string" && PATHNAME_RE.test(value);
}

/** The public URL for a pathname. Used by the studio's copy buttons. */
export function mediaUrl(pathname) {
  return `${MEDIA_URL_PREFIX}/${pathname}`;
}

/** Link a markdown document can carry, with alt text escaped for the syntax. */
export function markdownFor(pathname, alt) {
  const safeAlt = String(alt ?? "").replace(/[[\]]/g, "");
  return `![${safeAlt}](${mediaUrl(pathname)})`;
}
