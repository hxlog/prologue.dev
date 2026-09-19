import { NextResponse } from "next/server";

/**
 * The /studio gate.
 *
 * ## Why this is not a layout check
 *
 * The natural place for "only the author may see /studio" is the layout: it
 * runs before the page, it is written once, and nothing below it can forget.
 * Under `cacheComponents` that does not work, and the way it fails is worth
 * recording because the symptom does not point at the cause.
 *
 * A layout is part of the static shell Next prerenders for EVERY route. So the
 * layout runs at build time, with no cookie, and `redirect()` throws there. The
 * redirect is captured into the shell, and at request time a shell whose own
 * layout threw cannot be reconciled with a live request — React renders the
 * nearest error boundary instead of resuming. The route then answers **HTTP 200
 * with an error document**, not a 307, and `export const instant = false` on
 * the layout does not help: it correctly marks the segment as allowed to block,
 * but the thrown redirect was already baked into the shell.
 *
 * A proxy sidesteps all of it. It runs before routing, it has no static shell,
 * and a redirect from here is a real HTTP redirect. The cost is one cookie
 * check per /studio request — which is a SHA-256 of a 32-byte token, against a
 * table with a unique index on that hash. Negligible, and paid only by the one
 * person who uses this area.
 *
 * ## What it does NOT do
 *
 * It does not verify the session against the database, and it must not appear
 * to. A proxy cannot reach `pg` safely (it runs on every request including
 * static assets), and more importantly the pages still call `requireUser()`
 * themselves — this is the fast path that turns an unauthenticated hit into a
 * redirect before any rendering happens, not the security boundary. The
 * boundary is in the page, where a forged or expired cookie is caught by
 * `getSession()` against the real session table.
 *
 * ## Matcher
 *
 * Everything under /studio except the sign-in page and the auth actions. The
 * login page must be reachable while signed out, and a redirect there would
 * loop.
 */
export function proxy(request) {
  const { pathname, search } = request.nextUrl;

  // The sign-in page, and anything that signs in: reachable while signed out.
  if (pathname === "/studio/login") return NextResponse.next();

  const hasSession = request.cookies.has("__Host-prologue_session")
    || request.cookies.has("prologue_session");

  if (hasSession) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = "/studio/login";
  url.search = "";
  // `next` so the author lands where they were headed rather than on the
  // dashboard, which is what a bare redirect does and is mildly annoying every
  // single time.
  if (pathname !== "/studio") url.searchParams.set("next", pathname + search);

  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/studio/:path*"],
};
