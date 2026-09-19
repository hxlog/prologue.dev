import { getSession } from "../../../lib/auth/sessions";
import { StudioShell } from "../../../components/studio/shell";
import siteMetadata from "../../../../data/sitemetadata";

export const instant = false;

/**
 * The signed-in area.
 *
 * ## The layout does NOT redirect — and that is the whole trick
 *
 * The obvious design puts `requireUser()` (and therefore a `redirect()`) in
 * this layout. It does not work under `cacheComponents`, and the failure is
 * genuinely hard to read: the route answers **HTTP 200 with an error shell**
 * rather than a 307 to /studio/login.
 *
 * The reason is structural. A layout is part of the static shell Next
 * prerenders for every route, so this layout runs ONCE at build time with no
 * cookie — and `requireUser` throws its redirect then. The redirect lands in
 * the shell, and at request time there is no way to reconcile a shell whose own
 * layout threw with a live request, so React renders the nearest error boundary
 * instead of resuming. `instant = false` on the layout does not help: it marks
 * the segment as allowed to block, which it is, but the thrown redirect is
 * still captured during the shell pass.
 *
 * The fix is to let the redirect happen where it can actually be handled: in
 * the PAGE. Every page under this group calls `requireUser()` itself as its
 * first statement, and a page-level redirect (with `instant = false` on the
 * page, which they all set) produces a real 307. Verified: /studio, /studio/posts
 * and /studio/posts/[slug] all redirect correctly, while a signed-in request
 * renders the shell.
 *
 * `getSession` is called here WITHOUT redirecting, purely to label the rail.
 * When it is null the shell renders with an empty identity for one frame and
 * the page below redirects immediately — which is a strictly better failure
 * than an error page, and cannot be reached anyway, because no page under this
 * layout renders without a session.
 */
export default async function AppLayout({ children }) {
  const session = await getSession();

  return (
    <StudioShell user={session?.user ?? null} siteUrl={siteMetadata.siteUrl}>
      {children}
    </StudioShell>
  );
}
