/**
 * Cached content reads for the three catch-all routes.
 *
 * Under Cache Components a page that awaits `params` before rendering anything
 * URL-independent has no static shell, so /[...slug], /blog/[...slug] and
 * /tags/[...slug] hand the params promise to a <Suspense> child. That child is
 * request-time by definition -- which used to mean Shiki ran per request: a cold
 * `renderMarkdown` measured ~13.6 s, and that is what the p75 LCP of 13.21 s on
 * an article page was made of.
 *
 * These wrappers put the render behind `'use cache'` so the expensive part is
 * computed once at build time (generateStaticParams already visits every slug)
 * and again at each revalidation, never per request. They also make per-link
 * prefetching useful: <Link prefetch> can resolve the URL-specific content
 * before the click because the read is cached by slug.
 *
 * Only plain data crosses the cache boundary -- the loader's document carries a
 * lazy `body` getter that is not serialisable, so it is projected away here and
 * the HTML string travels instead.
 */
import "server-only";
import { cacheLife } from "next/cache";
import { getPosts, getPages, getBodyHtml } from "./index.js";

/** Drop the non-serialisable lazy `body` holder, keep everything renderable. */
function toMeta({ body, ...meta }) {
  return meta;
}

/**
 * Every post's metadata, no HTML. Related posts, adjacent links, tag pages and
 * the search archive only need this half.
 */
export async function getCachedPosts() {
  "use cache";
  cacheLife("max");
  return getPosts().map(toMeta);
}

/** One post: metadata plus the rendered body HTML (Shiki included). */
export async function getCachedPost(slug) {
  "use cache";
  cacheLife("max");
  const doc = getPosts().find((post) => post.slugAsParams === slug);
  if (!doc) return null;
  return { ...toMeta(doc), html: await getBodyHtml(doc) };
}

/** One markdown page (e.g. /about): metadata plus rendered body HTML. */
export async function getCachedPage(slug) {
  "use cache";
  cacheLife("max");
  const doc = getPages().find((page) => page.slugAsParams === slug);
  if (!doc) return null;
  return { ...toMeta(doc), html: await getBodyHtml(doc) };
}
