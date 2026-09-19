/**
 * The navigation's writes.
 *
 * The reader-facing read — `getNavItems`, the one that costs a query per cache
 * window on the busiest layout in the site — is in src/lib/content/nav.js. Same
 * split as posts: `content/*` reads and caches, `studio/*` writes and
 * invalidates.
 *
 * ## Where the page-coupled writes are NOT
 *
 * Keeping `nav_items` in step with `pages.show_in_nav`, and moving an entry
 * when a page is renamed, both happen inside `pages-write.js` — in the SAME
 * transaction as the page write. A page whose flag says "in the navigation"
 * with no entry to match is a broken state, and the only way two writes cannot
 * drift apart is if they are one write. This module therefore knows nothing
 * about pages except by `page_slug`, which is the pointer the studio reads.
 */

import { updateTag } from "next/cache";
import { query, queryMany } from "../db";

/** Every entry including hidden ones, for the studio's navigation editor. */
export async function listNavItems() {
  return queryMany(
    `SELECT id, label, href, external, visible, sort_order, page_slug
       FROM nav_items
      ORDER BY sort_order, created_at, href`
  );
}

export async function createNavItem({ label, href, external = false, visible = true }) {
  const clean = normaliseHref(href);
  if (!label || !clean) return { ok: false, reason: "invalid" };

  // max+1 rather than count: entries get deleted, and a count would then
  // collide with an existing sort_order and make the rendered order depend on
  // `created_at` for no reason.
  const { rows } = await query(
    `INSERT INTO nav_items (label, href, external, visible, sort_order)
     VALUES ($1, $2, $3, $4,
             coalesce((SELECT max(sort_order) + 1 FROM nav_items), 0))
     RETURNING id`,
    [String(label).trim(), clean, external === true, visible !== false]
  );

  invalidateNav();
  return { ok: true, id: rows[0].id, href: clean };
}

export async function updateNavItem(id, changes) {
  const sets = [];
  const params = [id];

  for (const [column, value] of [
    ["label", changes.label === undefined ? undefined : String(changes.label).trim()],
    ["href", changes.href === undefined ? undefined : normaliseHref(changes.href)],
    ["external", changes.external],
    ["visible", changes.visible],
    ["sort_order", changes.sortOrder],
  ]) {
    if (value === undefined) continue;
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  }

  if (!sets.length) return { ok: false, reason: "nothing_to_update" };

  const { rows } = await query(
    `UPDATE nav_items SET ${sets.join(", ")} WHERE id = $1 RETURNING id`,
    params
  );
  if (!rows.length) return { ok: false, reason: "not_found" };

  invalidateNav();
  return { ok: true };
}

export async function deleteNavItem(id) {
  const { rows } = await query(`DELETE FROM nav_items WHERE id = $1 RETURNING id`, [id]);
  if (!rows.length) return { ok: false, reason: "not_found" };
  invalidateNav();
  return { ok: true };
}

/**
 * Reorder, from a list of ids.
 *
 * One `UPDATE ... FROM unnest(...) WITH ORDINALITY` rather than a statement per
 * row: this runs from a pair of arrow buttons, and N round trips through
 * PgBouncer for an operation whose entire content is "these five ids are now in
 * this order" is the kind of thing that makes an admin feel slow.
 */
export async function reorderNavItems(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return { ok: false, reason: "empty" };

  await query(
    `UPDATE nav_items AS n
        SET sort_order = ordered.position
       FROM unnest($1::uuid[]) WITH ORDINALITY AS ordered(id, position)
      WHERE n.id = ordered.id`,
    [ids]
  );

  invalidateNav();
  return { ok: true, count: ids.length };
}

/**
 * Drop the cached header.
 *
 * Exported because the page actions need it without needing anything else here:
 * the row write happens inside `pages-write.js`'s transaction, and this is the
 * half of that bargain which requires `next/cache`.
 */
export function invalidateNav() {
  updateTag("nav");
}

/**
 * Hrefs are stored as paths with a leading slash, or as absolute URLs for
 * external entries. Normalising here means the header never has to decide what
 * a bare `blog` was meant to be.
 */
function normaliseHref(href) {
  const raw = String(href ?? "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  const path = raw.startsWith("/") ? raw : `/${raw}`;
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}
