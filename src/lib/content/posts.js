/**
 * Post reads.
 *
 * Every function here returns documents shaped like the Contentlayer output
 * they replace — same field names, same types, `body.html` / `body.raw`
 * included — so the route files that consume them did not have to be rewritten.
 * Keeping that shape is not nostalgia: it is what makes the migration
 * reviewable, because a diff in `src/app/**` then means a behaviour change
 * rather than a rename.
 *
 * Caching
 * -------
 * These are the reads behind the busiest pages on the site (home, /blog,
 * /tags/*, every post, the sitemap and three feed routes), and they are
 * deliberately NOT cached yet.
 *
 * `cacheComponents` is off in next.config.js while Contentlayer is still the
 * rendering source, and a `'use cache'` directive is only honoured when it is
 * on. Adding the directives now would be decoration that silently does nothing,
 * and the failure mode is invisible: pages that look cached and re-query on
 * every request. They go in with the flag, in the commit that turns
 * `cacheComponents` on, where the build can prove they take effect.
 *
 * The plan for then, so the tags are not invented later:
 *
 *   tag `posts`        — the whole collection; any write invalidates it
 *   tag `post:<slug>`  — one post; an edit to A must not evict B's page
 *
 * `cacheLife('max')` suits both: content changes only when the author
 * publishes, at which point the tag is invalidated immediately, so a long
 * lifetime costs nothing and keeps unaffected pages warm.
 *
 * `/studio` previews must never read through those — see `getPostForEditing`.
 */

import { query, queryOne } from "../db";
import { parseContentDate } from "./dates";

/** The list projection, which 0005 maintains from the current revision. */
const POST_COLUMNS = `
  p.id,
  p.slug,
  p.status,
  p.featured,
  p.cover_image,
  p.cover_image_desc,
  p.published_at,
  p.lastmod,
  p.giscus_enabled,
  p.seo_title,
  p.seo_description,
  p.og_image,
  p.title,
  p.description,
  p.headings,
  p.reading_time,
  p.content_hash,
  coalesce(
    (SELECT array_agg(t.slug ORDER BY pt.position)
       FROM post_tags pt JOIN tags t ON t.id = pt.tag_id
      WHERE pt.post_id = p.id),
    '{}'
  ) AS tags
`;

/** Slug fields, derived the same way Contentlayer derived them. */
function slugsFor(slug) {
  return {
    slugAsParams: slug,
    slug: `/blog/${slug}`,
    urlslug: `/blog/${slug}`,
  };
}

/**
 * Map a database row to the document shape the routes consume.
 *
 * `body` is only populated when the caller selected the html column; list
 * queries skip it, because the home page renders eight cards and does not need
 * 40 KB of rendered markdown for each.
 */
function toPost(row) {
  const date = parseContentDate(row.published_at);

  return {
    ...slugsFor(row.slug),
    title: row.title,
    description: row.description ?? "",
    publishDate: date ? date.toISOString() : null,
    lastmod: row.lastmod ? new Date(row.lastmod).toISOString() : null,
    image: row.cover_image ?? "",
    imageDesc: row.cover_image_desc ?? "",
    featured: row.featured === true,
    draft: row.status !== "published",
    status: row.status,
    tags: row.tags ?? [],
    headings: row.headings ?? [],
    readingTime: row.reading_time ?? null,
    _raw: { flattenedPath: `blog/${row.slug}` },
    ...(row.html !== undefined
      ? { body: { html: row.html, raw: row.markdown ?? "" } }
      : {}),
  };
}

/**
 * Every post, published and draft, newest first — the /blog archive and the
 * home page's Latest tab both want the drafts present and filter client-side
 * (they already did, with `draft !== true`).
 *
 * Not `'use cache'`: it is called from several differently-cached entry points
 * and from /studio, and a cached draft list would show a stale editor state
 * after an autosave. The published-only read below is the one that needs
 * caching, and it is what every reader-facing route actually uses.
 */
export async function getAllPosts({ includeDrafts = true } = {}) {
  const rows = await query(
    `SELECT ${POST_COLUMNS}
       FROM posts p
      WHERE p.status <> 'archived'
        AND ($1::boolean OR p.status = 'published')
      ORDER BY p.published_at DESC NULLS LAST, p.slug`,
    [includeDrafts]
  );
  return rows.map(toPost);
}

/**
 * The published collection, with `body.html`, for the feed routes.
 *
 * The feeds need the rendered HTML of every post in one go — that is the one
 * place the full body is legitimately read in bulk.
 */
export async function getPublishedPostsWithContent() {
  const rows = await query(
    `SELECT ${POST_COLUMNS}, r.html, r.markdown
       FROM posts p
       JOIN post_revisions r ON r.id = p.published_revision_id
      WHERE p.status = 'published'
      ORDER BY p.published_at DESC`
  );
  return rows.map(toPost);
}

/** One post with its rendered body. Returns null when there is no such post. */
export async function getPostBySlug(slug) {
  const row = await queryOne(
    `SELECT ${POST_COLUMNS}, r.html, r.markdown
       FROM posts p
       LEFT JOIN post_revisions r
         ON r.id = coalesce(p.published_revision_id, p.draft_revision_id)
      WHERE p.slug = $1`,
    [String(slug).toLowerCase()]
  );
  return row ? toPost(row) : null;
}

/**
 * A post as it currently exists in the editor, bypassing every cache.
 *
 * `/studio` must never render a cached body: autosave writes every few seconds
 * and the author has to see what they just typed. Reading through the cached
 * functions would show the last published revision until the tag was
 * invalidated.
 */
export async function getPostForEditing(slug) {
  const row = await queryOne(
    `SELECT ${POST_COLUMNS}, r.html, r.markdown, r.id AS revision_id,
            r.revision_number, r.renderer_version
       FROM posts p
       LEFT JOIN post_revisions r
         ON r.id = p.draft_revision_id
      WHERE p.slug = $1`,
    [String(slug).toLowerCase()]
  );
  return row ? { ...toPost(row), revisionId: row.revision_id } : null;
}

/** Total published-post count, for the sidebar's "文章" figure. */
export async function getPostStats() {
  const row = await queryOne(
    `SELECT count(*)::int AS posts,
            coalesce(sum((reading_time->>'words')::int), 0)::int AS words
       FROM posts
      WHERE status = 'published'`
  );
  return { posts: row?.posts ?? 0, words: row?.words ?? 0 };
}
