/**
 * Is an object referenced? By what, and how many times?
 *
 * Plain Node on purpose — no `next/cache` import anywhere in this file. The
 * delete precondition lives here and the proxy's publication check delegates
 * here, and both of those have to be runnable from a script against the real
 * database. That is the same split `posts-write.js` documents: the module that
 * decides is separate from the module that invalidates, because `updateTag` only
 * works inside a Server Action and a call from here would fail at runtime with
 * an error naming the tag rather than the call site.
 *
 * ## Three stores, three shapes
 *
 * A media URL can appear in:
 *   - `post_revisions.html`   — the RENDERED artifact, so the URL is in an `src`
 *   - `page_revisions.markdown` — the SOURCE, so the URL is in `![alt](…)`
 *   - `collection_entries.values` — JSONB, so the URL is one value among many
 *
 * Missing one of those is how a published page ends up with a broken image, and
 * there is no single table to ask. Substring search over all three is the honest
 * answer: a pathname is 40-odd random characters, so a false positive is not
 * something that can happen by accident.
 */

import { query } from "../db";

/** How many documents reference a pathname, broken down by where. */
export async function usageFor(pathname) {
  const needle = `%${pathname}%`;
  const { rows } = await query(
    `SELECT
       (SELECT count(*)::int FROM post_revisions WHERE html LIKE $1) AS posts,
       (SELECT count(*)::int FROM page_revisions WHERE markdown LIKE $1) AS pages,
       (SELECT count(*)::int FROM collection_entries WHERE values::text LIKE $1) AS entries`,
    [needle]
  );
  const counts = rows[0] ?? { posts: 0, pages: 0, entries: 0 };
  return { ...counts, total: counts.posts + counts.pages + counts.entries };
}

/**
 * Whether an object is reachable from something the public can see.
 *
 * Deliberately asks about PUBLISHED revisions only — `posts.published_revision_id`
 * and `pages.published_revision_id` — so an image that exists solely in a draft
 * answers false and the proxy refuses it to a caller with no session. That
 * distinction is the entire reason the store is private rather than an
 * unguessable public bucket; without it, "private" would mean nothing more than
 * "the URL is hard to guess", and a screenshot pasted into a draft that never
 * shipped would be readable by anyone holding the link.
 *
 * The answer is derived from the revisions because that is where the truth is:
 * the rendered artifact is what a reader gets, so if the URL is in the HTML it
 * is in the post.
 *
 * Note this returns false for an image in no document at all, which includes a
 * fresh upload. Correct — the studio's own preview sends a session cookie.
 */
export async function isPublishedRow(pathname) {
  const { rows } = await query(
    `SELECT
       EXISTS (
         SELECT 1 FROM posts p
           JOIN post_revisions r ON r.id = p.published_revision_id
          WHERE r.html LIKE $1
       ) AS in_post,
       EXISTS (
         SELECT 1 FROM pages pg
           JOIN page_revisions r ON r.id = pg.published_revision_id
          WHERE r.markdown LIKE $1
       ) AS in_page,
       EXISTS (
         SELECT 1 FROM collection_entries ce
           JOIN collections c ON c.id = ce.collection_id
          WHERE ce.values::text LIKE $1
            AND c.public_read
       ) AS in_collection`,
    [`%${pathname}%`]
  );

  const r = rows[0];
  return Boolean(r && (r.in_post || r.in_page || r.in_collection));
}
