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
 * Two families of read, split by who consumes them, and the split is the whole
 * design:
 *
 *   PUBLISHED  — `getPublishedPostsWithContent`, `getPostSlugs`, and the
 *                `getPostBySlug` path when the row is published. These back the
 *                busiest pages on the site (home, /blog, /tags/*, every post,
 *                the sitemap, three feed routes). They are wrapped in
 *                `'use cache'` and tagged, so a publish invalidates exactly
 *                what changed.
 *
 *   EDITING    — `getAllPosts`, `getPostForEditing`, `getPostStats`. /studio
 *                reads these. They are deliberately NOT cached: autosave
 *                writes every few seconds and the author has to see what they
 *                just typed, so a cached read would show the last published
 *                revision until something invalidated it.
 *
 * Tags:
 *
 *   `posts`        — the whole collection; any write bumps it
 *   `post:<slug>`  — one post; an edit to A must not evict B's page
 *
 * `cacheLife('max')` suits both: content changes only when the author
 * publishes, at which point the tag is invalidated immediately, so a long
 * lifetime costs nothing and keeps unaffected pages warm. The exception is the
 * cache tag, not the lifetime.
 *
 * A trap worth knowing about, because it is silent: a `'use cache'` function
 * may only be called from a request scope that has one. Calling a cached read
 * from inside another cached function is fine; calling one from a route handler
 * that Next has decided is dynamic is not, and the error names the function,
 * not the call site.
 */

import { cacheLife, cacheTag } from "next/cache";
import { query, queryOne, queryMany } from "../db";
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
  p.source_path,
  coalesce(
    (SELECT array_agg(t.slug ORDER BY pt.position)
       FROM post_tags pt JOIN tags t ON t.id = pt.tag_id
      WHERE pt.post_id = p.id),
    '{}'
  ) AS tags
`;

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
    slugAsParams: row.slug,
    // The route. Lowercased, matching what the router resolves.
    slug: `/blog/${row.slug}`,
    // `urlslug` is the CASE-PRESERVING source path without the extension, which
    // is what the "view on GitHub" link at the foot of every post is built from:
    //   .../data/content${urlslug}.md
    //   -> .../data/content/blog/2023-Introduction-to-articles.md
    // Falling back to the lowercased slug is wrong for 44 of 63 posts — GitHub
    // is case-sensitive and the lowercased path 404s — so a row without a
    // source_path gets null and the page omits the link rather than guessing.
    // See migration 0007.
    urlslug: row.source_path ? `/${row.source_path.replace(/\.md$/, "")}` : null,
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
 * Every post, published and draft, newest first — /studio's list and the
 * "共 N 篇文章" count. NOT cached; see the header.
 */
export async function getAllPosts({ includeDrafts = true } = {}) {
  // queryMany, not query: the latter returns pg's full result object, and
  // `.map` on it is a TypeError rather than an empty list.
  const rows = await queryMany(
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
 * Every published post, newest first — the reader-facing list.
 *
 * This is what `/`, `/blog`, `/tags/*` and the sitemap actually want. They used
 * to call `getAllPosts()` and filter `draft !== true` in the component, which
 * had two consequences worth naming: drafts travelled in the RSC payload to
 * every reader, and the list could not be cached because it changed whenever a
 * draft was autosaved.
 *
 * Ordering matches `getAllPosts` exactly (`published_at DESC NULLS LAST, slug`)
 * so the two agree on ties. That matters because `/blog` re-sorts by date with
 * `compareDesc`, and the previous read's order is the input to a stable sort —
 * two posts share 2022-11-14, so a different tie-break here would reorder them
 * on the archive page.
 */
export async function getPublishedPosts() {
  "use cache";
  cacheLife("max");
  cacheTag("posts");

  const rows = await queryMany(
    `SELECT ${POST_COLUMNS}
       FROM posts p
      WHERE p.status = 'published'
      ORDER BY p.published_at DESC NULLS LAST, p.slug`
  );
  return rows.map(toPost);
}

/**
 * The published collection, with `body.html`, for the feed routes.
 *
 * The feeds need the rendered HTML of every post in one go — that is the one
 * place the full body is legitimately read in bulk.
 *
 * The `slug` tie-break is load-bearing. Two posts share a publish date
 * (2022-11-14), and without a tie-break PostgreSQL returns whichever row it
 * reaches first — so the feed's item order, and therefore the diff against
 * production, would be arbitrary and could change on any re-import or
 * autovacuum. Ascending slug is what the live feed emits.
 */
export async function getPublishedPostsWithContent() {
  "use cache";
  cacheLife("max");
  // The collection tag only: this read spans every post, so any publish
  // invalidates it. A per-post tag would be useless here because the result
  // depends on all of them at once.
  cacheTag("posts");

  const rows = await queryMany(
    `SELECT ${POST_COLUMNS}, r.html, r.markdown
       FROM posts p
       JOIN post_revisions r ON r.id = p.published_revision_id
      WHERE p.status = 'published'
      ORDER BY p.published_at DESC, p.slug`
  );
  return rows.map(toPost);
}

/**
 * One post with its rendered body. Returns null when there is no such post.
 *
 * Cached, and tagged per post. A draft is served through here too (a preview
 * link may point at one), so the tag is applied unconditionally: a slug that is
 * not yet published is still a slug, and the tag has to exist before the first
 * publish invalidates it.
 */
export async function getPostBySlug(slug) {
  "use cache";
  cacheLife("max");
  cacheTag("posts", `post:${String(slug).toLowerCase()}`);

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
  "use cache";
  cacheLife("max");
  cacheTag("posts");

  const row = await queryOne(
    `SELECT count(*)::int AS posts,
            coalesce(sum((reading_time->>'words')::int), 0)::int AS words
       FROM posts
      WHERE status = 'published'`
  );
  return { posts: row?.posts ?? 0, words: row?.words ?? 0 };
}

/**
 * Every published post's route segments, for `generateStaticParams`.
 *
 * Drafts are excluded here even though `getAllPosts` includes them: a draft's
 * page must 404 (the page component checks `draft`), and prerendering it would
 * defeat that by writing a real route for it.
 */
export async function getPostSlugs() {
  "use cache";
  cacheLife("max");
  cacheTag("posts");

  const rows = await queryMany(
    `SELECT slug FROM posts WHERE status = 'published' ORDER BY published_at DESC`
  );
  return rows.map((r) => r.slug);
}
