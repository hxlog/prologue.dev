import { NextResponse } from "next/server";

import { getSession } from "../../../../lib/auth/sessions";
import { getObject } from "../../../../lib/media/blob";
import { isMediaPathname } from "../../../../lib/media/paths";
import { isMediaPublished } from "../../../../lib/media/library";

/**
 * The image proxy — the only way any image in this site is served.
 *
 * ## Why images are not served from Blob directly
 *
 * The store is private. `access: 'private'` means the raw blob URL answers 403
 * to an unauthenticated fetch — verified, and asserted by
 * `scripts/studio/blob-probe.mjs`. That is the point: a library where every
 * upload is world-readable is a library where the screenshots in an unpublished
 * draft are too, and a self-hosted platform has no business publishing those.
 *
 * So this route is the join. A pathname is unguessable (`media/<y>/<m>/<8 hex>-<slug>.jpg`)
 * and this route decides, per request, whether the requester may have it.
 *
 * ## The rule
 *
 *   - an object referenced by a PUBLISHED post or page → serve to anyone
 *   - anything else → serve only to a caller with a session
 *
 * The first half has to be public: `next/image` fetches this URL server-side
 * with no cookie, and RSS readers, Open Graph crawlers and every reader's
 * browser fetch it too. The second half is why the store is private at all. An
 * image uploaded into a draft that never shipped is in the "anything else" case
 * and answers 404 to the public — not 403, because a 403 confirms an object is
 * there, and the set of things a stranger can learn about unpublished work
 * should be empty.
 *
 * ## Why this is not a server action or a cached route
 *
 * It is a GET with no side effects and a URL that never changes. `_next/image`
 * calls it once per size and the CDN caches from there, which is why the
 * response carries a long `s-maxage` and an ETag. A pathname is never
 * overwritten (`allowOverwrite: false` at both the ticket and the server write),
 * so an object at a URL is immutable and any cached copy of it is correct
 * forever.
 */
export async function GET(_request, { params }) {
  const { path } = await params;

  // The catch-all arrives as segments. Rejoining with "/" is what makes the
  // nested `media/2026/09/...` shape survive, and it is also why the validation
  // below has to be exact rather than a prefix check: everything after
  // `/api/img/` is attacker-controlled.
  const pathname = Array.isArray(path) ? path.join("/") : String(path ?? "");

  if (!isMediaPathname(pathname)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const [published, session] = await Promise.all([
    isMediaPublished(pathname),
    getSession(),
  ]);

  if (!published && !session) {
    // Deliberately indistinguishable from "no such object".
    return new NextResponse("Not found", { status: 404 });
  }

  let result;
  try {
    result = await getObject(pathname);
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
  if (!result || result.statusCode !== 200 || !result.stream) {
    return new NextResponse("Not found", { status: 404 });
  }

  const headers = new Headers({
    "Content-Type": result.blob.contentType,
    // The bytes are ours and the type came from an allowlist at upload, but a
    // wrong guess about a file that a browser then executes is not worth the
    // risk: nosniff makes the Content-Type the only interpretation available.
    "X-Content-Type-Options": "nosniff",
    // Inline, so the lightbox and a direct open display the image rather than
    // downloading it — the same behaviour next.config.js sets for /_next/image.
    "Content-Disposition": "inline",
    ETag: result.blob.etag,
    // Immutable by construction: a pathname carries a random component and is
    // never overwritten. A published image is public and can be cached at the
    // edge indefinitely; one that is only visible to a session must NOT be, or
    // a shared cache could hand it to somebody else.
    "Cache-Control": published
      ? "public, max-age=31536000, s-maxage=31536000, immutable"
      : "private, no-store",
  });

  if (Number.isFinite(result.blob.size)) {
    headers.set("Content-Length", String(result.blob.size));
  }

  return new NextResponse(result.stream, { status: 200, headers });
}
