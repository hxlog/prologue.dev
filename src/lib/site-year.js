/**
 * The site's current year, for the footer copyright.
 *
 * Why this is a cached function rather than a `new Date()` in the footer.
 *
 * Under `cacheComponents`, reading the wall clock during prerender is an error:
 * the rendered output would then depend on when the build happened rather than
 * on any input, so two builds of identical content would produce different
 * bytes. The documented fix is to compute the value inside a `'use cache'`
 * boundary, where it is stable for the lifetime of the entry, and that is what
 * this does.
 *
 * Why it uses the same profile as the content, and not something shorter. Next
 * derives a route's Revalidate/Expire from the SHORTEST-lived cache anywhere in
 * its tree — and the layout wraps every route on the site. A one-hour window
 * here would therefore have capped the entire site at one hour of revalidate,
 * including pages whose content changes only when the author publishes. That is
 * the opposite of what the content caches ask for, so the year rides the
 * content profile instead: computed at build, refreshed when the content cache
 * refreshes.
 *
 * What that costs, stated plainly: a deployment that outlives a year boundary
 * shows the previous year for up to one content-cache window, or until the next
 * deploy, whichever comes first. For a site whose content cache is refreshed on
 * every publish, that is not a real exposure. It is also what the site did
 * before this change — a static build bakes in the build year — so nothing has
 * regressed.
 *
 * `getUTCFullYear`, not the local year: the entries are shared across regions,
 * so a per-region year would put different values in different places.
 */

import { cacheLife } from "next/cache";

export async function getSiteYear() {
  "use cache";
  cacheLife("max");

  return new Date().getUTCFullYear();
}
