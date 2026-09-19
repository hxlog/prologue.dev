/**
 * Every cache tag this app uses, and the invalidation that goes with a write.
 *
 * Centralised because the failure mode of getting it wrong is invisible. A
 * cache tag that nothing invalidates is a page that serves yesterday's title
 * forever; a tag that is invalidated too broadly is a page that rebuilds on
 * every keystroke. Neither shows up as an error, and neither is caught by the
 * build — so the tag names live in one file and writers import them rather than
 * typing the string.
 *
 * ## Why `updateTag` and not `revalidateTag`
 *
 * Under `cacheComponents` these are different operations:
 *
 *   revalidateTag(tag, profile) — marks the entry stale. The NEXT request
 *     recomputes it in the background and the one after that sees the new value.
 *     Correct for a reader-facing page, where a few hundred milliseconds of
 *     staleness are free.
 *
 *   updateTag(tag) — expires it immediately, in the same request. Server-Action
 *     only. This is "read your own writes": the author hits Save, and the post
 *     page must show the new text the first time they look at it, not the second.
 *
 * Studio writes use `updateTag`. There is exactly one author, so the
 * invalidation volume is one document, not a fleet, and the cost of recomputing
 * eagerly is one query.
 *
 * ## The two families
 *
 *   `posts` / `pages` / `collections` — the COLLECTION. Any write to any member
 *     invalidates every list that spans the collection (home, /blog, sitemap,
 *     the feeds, the tag sidebar). Necessary, not lazy: those pages genuinely
 *     depend on every member.
 *
 *   `post:<slug>` / `page:<slug>` / `collection:<slug>` — ONE member. Editing a
 *     microblog entry must not evict the friend-links page.
 *
 * A write touches both. The collection tag is what makes the new post appear on
 * /blog; the per-item tag is what keeps the other 62 post pages warm.
 */

import { updateTag } from "next/cache";

/** Tag names, in one place. */
export const TAGS = {
  posts: "posts",
  post: (slug) => `post:${String(slug).toLowerCase()}`,

  pages: "pages",
  page: (slug) => `page:${String(slug).toLowerCase()}`,

  collections: "collections",
  collection: (slug) => `collection:${slug}`,
  collectionSchema: (slug) => `collection:${slug}:schema`,

  /** The taxonomy: tag rows, labels, aliases and counts. */
  tags: "tags",

  /**
   * The header's links.
   *
   * Separate from `pages` deliberately. The nav is rendered by the SITE LAYOUT,
   * which wraps every public route, so an invalidation that reached it would
   * rebuild the whole site; and `pages` is invalidated by every page autosave,
   * most of which change nothing about the navigation. Nothing shares a tag with
   * `nav`.
   */
  nav: "nav",

  /** The unified search index. Written on every publish, read by /api/search. */
  search: "search",

  /**
   * The media library.
   *
   * Covers two reads that must move together: the library listing, and
   * `isPublishedMedia` — the question the /api/img proxy answers. Publishing a
   * post is what makes its images public, so `invalidatePost` drops this tag as
   * well as a media write doing so. Without that, an image uploaded into a draft
   * and then published would keep the "not published" answer until the cache
   * expired, and the reader would get a 404 for a picture that is visibly in the
   * post they are looking at.
   */
  media: "media",

  /**
   * The redirect table.
   *
   * Read on the 404 path by the two catch-all routes, so a tag that nothing
   * drops means a retired URL keeps 404ing for thirty days after the author
   * renamed the thing it pointed at — which is exactly the moment they are
   * looking at it. `setRedirect` writes the row; `invalidateRedirects` is what
   * makes the reader see it.
   */
  redirects: "redirects",
};

/**
 * Invalidate everything that depends on a post.
 *
 * Called on publish, revert, delete, and — via autosave — on every save that
 * actually changed the bytes. Autosave is NOT a cache problem: it only writes
 * when `content_hash` moved (see the guard in `saveDraft`), so an idle editor
 * generates no invalidation at all.
 *
 * The `tags` tag is bumped because a post's tag list is part of the taxonomy
 * counts that /blog's sidebar renders, and the `search` tag because
 * `search_index` is rewritten from the rendered HTML.
 */
export function invalidatePost(slug) {
  updateTag(TAGS.posts);
  updateTag(TAGS.tags);
  updateTag(TAGS.search);
  // Publishing is what makes a draft's images reachable through /api/img, so
  // the proxy's "is this published" answer is part of what a post write
  // invalidates. See the note on TAGS.media.
  updateTag(TAGS.media);
  if (slug) updateTag(TAGS.post(slug));
}

export function invalidatePage(slug) {
  updateTag(TAGS.pages);
  if (slug) updateTag(TAGS.page(slug));
}

/**
 * Invalidate the header.
 *
 * Called from the page write path when `show_in_nav` moved a row, and from the
 * navigation editor on any change. The read it drops is in
 * src/lib/content/nav.js; the writes are in src/lib/studio/nav.js.
 */
export function invalidateNav() {
  updateTag(TAGS.nav);
}

/**
 * Invalidate the redirect table.
 *
 * Called by every write that adds, changes or removes a forwarding address —
 * the two rename actions and the settings screen's redirect editor. See the
 * note on `TAGS.redirects` for what goes stale without it.
 */
export function invalidateRedirects() {
  updateTag(TAGS.redirects);
}

/**
 * Invalidate a collection's entries.
 *
 * `schema` is bumped only when the field definitions change — adding a field
 * must rebuild the editor's form, but a new microblog entry must not invalidate
 * the schema read that every editor page makes.
 */
export function invalidateCollection(slug, { schema = false } = {}) {
  updateTag(TAGS.collections);
  updateTag(TAGS.collection(slug));
  if (schema) updateTag(TAGS.collectionSchema(slug));
}
