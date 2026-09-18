/**
 * Tag reads.
 *
 * Replaces src/lib/tag-counts.js, which computed counts in a module-scope IIFE
 * over the Contentlayer array. The IIFE was a correctness hazard as much as a
 * performance one: it froze at import time, so any course that changed a post's
 * tags at runtime (which /studio now does) would keep serving the old counts
 * until the process restarted.
 *
 * Counts only include PUBLISHED posts. The previous version skipped drafts in
 * JS; doing it in SQL means the number in the sidebar is always the number of
 * links a reader can actually follow.
 */

import { queryOne, queryMany } from "../db";

/**
 * Tag slug -> published post count.
 *
 * Returns an object rather than a Map because that is what `PostsLayout`
 * indexes into (`tagCounts[tag]`), and changing the shape would mean touching
 * the layout for no benefit.
 */
export async function getTagCounts() {
  const rows = await queryMany(
    `SELECT t.slug, count(*)::int AS n
       FROM tags t
       JOIN post_tags pt ON pt.tag_id = t.id
       JOIN posts p      ON p.id = pt.post_id
      WHERE p.status = 'published'
      GROUP BY t.slug`
  );

  const counts = {};
  for (const row of rows) counts[row.slug] = row.n;
  return counts;
}

/**
 * Tag slugs ordered by count desc — the archive sidebar and the home tabs.
 *
 * Ties break on `tags.sort_order`, not on the slug. The previous
 * implementation built its list from `Object.keys(counts).sort(...)` over the
 * Contentlayer array, so four tags tied on 8 posts and the tie was resolved by
 * whichever post the array happened to reach first — an arbitrary order that
 * was nonetheless visible in the sidebar on /blog and every tag page. Seeding
 * `sort_order` to that exact order keeps the sidebar unchanged, and makes the
 * order a stored value instead of an accident of iteration.
 */
export async function getSortedTags() {
  const rows = await queryMany(
    `SELECT t.slug
       FROM tags t
       JOIN post_tags pt ON pt.tag_id = t.id
       JOIN posts p      ON p.id = pt.post_id
      WHERE p.status = 'published'
      GROUP BY t.slug, t.sort_order
      ORDER BY count(*) DESC, t.sort_order, t.slug`
  );
  return rows.map((r) => r.slug);
}

/** The whole taxonomy, including tags with no published posts (for /studio). */
export async function getAllTags() {
  return queryMany(
    `SELECT t.slug, t.label, t.description, t.sort_order,
            (SELECT count(*)::int
               FROM post_tags pt JOIN posts p ON p.id = pt.post_id
              WHERE pt.tag_id = t.id AND p.status = 'published') AS post_count
       FROM tags t
      ORDER BY t.sort_order, t.slug`
  );
}

/** slug -> Chinese display label. Replaces data/tagLabels.js for the read path. */
export async function getTagLabels() {
  const rows = await queryMany(`SELECT slug, label FROM tags`);
  const labels = {};
  for (const row of rows) labels[row.slug] = row.label;
  return labels;
}

/**
 * Resolve a URL segment to a canonical tag slug.
 *
 * /tags/Web3 must keep working after the taxonomy folded it into Crypto. That
 * redirect currently lives in next.config.js as a hardcoded rule; resolving it
 * here means the tag page and the redirect agree, and a future rename is a row
 * in tag_aliases rather than a config change plus a deploy.
 *
 * Returns null when the segment is neither a tag nor an alias, which the caller
 * turns into a 404.
 */
export async function resolveTagSlug(candidate) {
  const row = await queryOne(
    `SELECT resolve_tag_slug($1) AS slug, tag_is_known($1) AS known`,
    [String(candidate)]
  );
  return row?.known ? row.slug : null;
}
