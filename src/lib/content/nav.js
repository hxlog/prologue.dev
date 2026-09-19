/**
 * The header's links.
 *
 * Lives here rather than in src/lib/studio/ because the reader-facing read is
 * the important half: the header is on every page, and this is the function
 * that puts a database query in front of the first byte of every response. The
 * author-facing writes — create, reorder, hide — are in src/lib/studio/nav.js,
 * the same split as posts (`content/posts.js` reads, `studio/posts-write.js`
 * writes).
 *
 * `nav_items` replaced `data/headerNavLinks.js`, which had drifted from the
 * table: the seed was English with a Tags entry the header never showed. See
 * db/migrations/0010_nav_becomes_data.sql for how the two were reconciled.
 */

import { cacheLife, cacheTag } from "next/cache";
import { queryMany } from "../db";

/**
 * The links the header renders, in order.
 *
 * Note the ORDER BY. `sort_order` alone is not a total order — two entries
 * inserted in the same transaction share it — so `created_at` and then `href`
 * break ties. Without them the header could reorder itself between requests,
 * which is the kind of bug that gets diagnosed as "the nav is haunted".
 */
export async function getNavItems() {
  "use cache";
  cacheLife("max");
  cacheTag("nav");

  const rows = await queryMany(
    `SELECT id, label, href, external, page_slug
       FROM nav_items
      WHERE visible
      ORDER BY sort_order, created_at, href`
  );

  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    href: r.href,
    external: r.external === true,
    pageSlug: r.page_slug ?? null,
  }));
}
