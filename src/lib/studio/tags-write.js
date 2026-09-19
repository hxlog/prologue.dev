/**
 * Taxonomy writes: tags, their labels and their aliases.
 *
 * ## Position in the system
 *
 * The taxonomy arrived from the static site as a fixed 15-tag list with Chinese
 * labels in `data/tagLabels.js` and one merged slug (`Web3` → `Crypto`). The
 * READ path has been database-backed for a while (`src/lib/content/tags.js`),
 * but nothing could change the list without an import. This is that.
 *
 * ## Slugs are the URL and the alias table is the safety net
 *
 * `/tags/<slug>` is a public URL that other people link to, so a slug is not
 * something to rename casually. When one does change, the old slug becomes an
 * ALIAS — a row in `tag_aliases` — and `resolve_tag_slug()` keeps the old URL
 * working. That function is what the tag page already calls, so an alias
 * created here takes effect with no other change.
 *
 * Which means renaming has two steps and they must both happen: update the tag,
 * then insert the alias. Skipping the second is a silent 404 for every inbound
 * link, which is the failure this module exists to make impossible.
 *
 * ## Why deletion is refused more often than it is allowed
 *
 * A tag with published posts CANNOT be deleted. Deleting it would silently drop
 * those posts from a tag page readers can reach, and `post_tags` rows would
 * cascade away with no record that they were ever there — the next import would
 * not restore them either, because the source of truth is the database now. The
 * refusal is not a warning; it is a hard stop, and the message names the count
 * so the author can go and deal with the posts.
 */

import { query, pool } from "../db";

/** Every tag with its usage counts, for the studio's taxonomy screen. */
export async function listTagsForStudio() {
  const { rows } = await query(
    `SELECT t.id, t.slug, t.label, t.description, t.sort_order,
            (SELECT count(*)::int FROM post_tags pt
              WHERE pt.tag_id = t.id) AS total_posts,
            (SELECT count(*)::int
               FROM post_tags pt JOIN posts p ON p.id = pt.post_id
              WHERE pt.tag_id = t.id AND p.status = 'published') AS published_posts,
            coalesce(
              (SELECT array_agg(a.alias_slug ORDER BY a.alias_slug)
                 FROM tag_aliases a WHERE a.tag_id = t.id),
              '{}'
            ) AS aliases
       FROM tags t
      ORDER BY t.sort_order, t.slug`
  );
  return rows;
}

/**
 * Create a tag.
 *
 * The slug is normalised to the form this site uses — English, capitalised, no
 * spaces — because it is a URL segment and because the whole taxonomy follows
 * that convention. A Chinese label is expected and stored separately: the
 * display name and the URL are different things and conflating them is how a
 * taxonomy ends up with percent-encoded slugs.
 */
export async function createTag({ slug, label, description, sortOrder }) {
  const clean = slugifyTag(slug || label);
  if (!clean) return { ok: false, reason: "invalid_slug" };

  const text = String(label ?? "").trim();
  if (!text) return { ok: false, reason: "invalid_label" };

  const { rows: clash } = await query(`SELECT 1 FROM tags WHERE slug = $1`, [clean]);
  if (clash.length) return { ok: false, reason: "duplicate", slug: clean };

  // An alias with this name would shadow the new tag: `resolve_tag_slug` looks
  // at aliases, so /tags/<clean> would render the OTHER tag while this one
  // existed invisibly.
  const { rows: aliasClash } = await query(
    `SELECT tag_id FROM tag_aliases WHERE alias_slug = $1`,
    [clean]
  );
  if (aliasClash.length) return { ok: false, reason: "alias_conflict", slug: clean };

  const { rows } = await query(
    `INSERT INTO tags (slug, label, description, sort_order)
     VALUES ($1, $2, $3,
             coalesce($4, (SELECT max(sort_order) + 1 FROM tags), 0))
     RETURNING id`,
    [clean, text, description ? String(description).trim() : null, sortOrder ?? null]
  );

  return { ok: true, id: rows[0].id, slug: clean };
}

export async function updateTag(id, changes) {
  const sets = [];
  const params = [id];

  for (const [column, value] of [
    ["label", changes.label === undefined ? undefined : String(changes.label).trim()],
    ["description", changes.description === undefined ? undefined : orNull(changes.description)],
    ["sort_order", changes.sortOrder],
  ]) {
    if (value === undefined) continue;
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  }

  if (!sets.length) return { ok: false, reason: "nothing_to_update" };

  const { rowCount } = await query(
    `UPDATE tags SET ${sets.join(", ")} WHERE id = $1`,
    params
  );
  if (!rowCount) return { ok: false, reason: "not_found" };
  return { ok: true };
}

/**
 * Rename a tag's slug, recording the old one as an alias.
 *
 * The two writes are one transaction and that is not optional. A rename without
 * the alias is a 404 for every inbound link; an alias without the rename is a
 * row that redirects a URL to itself. There is no useful state in between.
 *
 * The alias insert is `ON CONFLICT DO UPDATE` so that A→B→A leaves ONE alias
 * row pointing where the tag actually is, rather than a chain that the resolver
 * would have to walk.
 */
export async function renameTag(id, nextSlug) {
  const clean = slugifyTag(nextSlug);
  if (!clean) return { ok: false, reason: "invalid_slug" };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: current } = await client.query(
      `SELECT slug FROM tags WHERE id = $1`,
      [id]
    );
    if (!current.length) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "not_found" };
    }
    if (current[0].slug === clean) {
      await client.query("ROLLBACK");
      return { ok: true, unchanged: true, slug: clean };
    }

    const { rows: clash } = await client.query(
      `SELECT 1 FROM tags WHERE slug = $1`,
      [clean]
    );
    if (clash.length) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "duplicate", slug: clean };
    }

    await client.query(`UPDATE tags SET slug = $2 WHERE id = $1`, [id, clean]);

    await client.query(
      `INSERT INTO tag_aliases (alias_slug, tag_id) VALUES ($1, $2)
       ON CONFLICT (alias_slug) DO UPDATE SET tag_id = EXCLUDED.tag_id`,
      [current[0].slug, id]
    );

    await client.query("COMMIT");
    return { ok: true, slug: clean, previous: current[0].slug };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** An alias that points a retired slug at a tag. */
export async function addAlias(tagId, aliasSlug) {
  const clean = slugifyTag(aliasSlug);
  if (!clean) return { ok: false, reason: "invalid_slug" };

  const { rows: clash } = await query(`SELECT 1 FROM tags WHERE slug = $1`, [clean]);
  if (clash.length) return { ok: false, reason: "duplicate", slug: clean };

  await query(
    `INSERT INTO tag_aliases (alias_slug, tag_id) VALUES ($1, $2)
     ON CONFLICT (alias_slug) DO UPDATE SET tag_id = EXCLUDED.tag_id`,
    [clean, tagId]
  );
  return { ok: true, slug: clean };
}

export async function removeAlias(aliasSlug) {
  const { rowCount } = await query(`DELETE FROM tag_aliases WHERE alias_slug = $1`, [
    String(aliasSlug),
  ]);
  return { ok: rowCount === 1 };
}

/**
 * Delete a tag.
 *
 * Refused while any post uses it, published or not. A draft using the tag is
 * still a post the author is working on, and silently dropping the association
 * would lose work they would have to redo. `force` exists for the case where
 * the author has already dealt with the posts and the count is stale — it is
 * the caller's job to have shown them the number first.
 */
export async function deleteTag(id, { force = false } = {}) {
  const { rows } = await query(
    `SELECT t.slug, (SELECT count(*)::int FROM post_tags pt WHERE pt.tag_id = t.id) AS n
       FROM tags t WHERE t.id = $1`,
    [id]
  );
  if (!rows.length) return { ok: false, reason: "not_found" };

  if (rows[0].n > 0 && !force) {
    return { ok: false, reason: "in_use", count: rows[0].n, slug: rows[0].slug };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Aliases and post_tags both cascade, but the search rows do not follow a
    // tag at all — `search_index.tags` is a denormalised array, so a deleted
    // tag would live on in every post's row and keep matching queries.
    await client.query(`DELETE FROM tags WHERE id = $1`, [id]);
    await client.query(
      `UPDATE search_index SET tags = array_remove(tags, $1), updated_at = now()
        WHERE $1 = ANY(tags)`,
      [rows[0].slug]
    );
    await client.query("COMMIT");
    return { ok: true, slug: rows[0].slug, detachedPosts: rows[0].n };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Reorder, from a list of tag ids.
 *
 * This is the sidebar's order on /blog, so it is a real visible decision rather
 * than housekeeping. Positions count from 0 to match every other `sort_order`
 * in this codebase; see the note in src/lib/studio/nav.js for why that is worth
 * being explicit about.
 */
export async function reorderTags(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return { ok: false, reason: "empty" };

  await pool.query(
    `UPDATE tags AS t
        SET sort_order = ordered.position - 1
       FROM unnest($1::uuid[]) WITH ORDINALITY AS ordered(id, position)
      WHERE t.id = ordered.id`,
    [ids]
  );
  return { ok: true, count: ids.length };
}

/**
 * A slug for the URL.
 *
 * Preserves case, unlike `slugify` in revisions.js which lowercases: the
 * taxonomy's canonical slugs are capitalised (`Economics`, `Crypto`, `AI`) and
 * `/tags/<Slug>` matching is case-sensitive on the server. Lowercasing would
 * rename all fifteen tags the first time one was edited, and the redirect from
 * the old capitalised form is not something the alias table would cover.
 */
function slugifyTag(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return (
    raw
      .replace(/\s+/g, "-")
      // Strip anything that is not a letter, a digit, a dash or an underscore.
      // `\p{L}` keeps CJK, so a Chinese-only label still produces a usable slug;
      // the collision check above is what makes that safe.
      .replace(/[^\p{L}\p{N}_-]+/gu, "")
      .replace(/^-+|-+$/g, "")
  );
}

function orNull(value) {
  const text = value === null || value === undefined ? "" : String(value).trim();
  return text === "" ? null : text;
}
