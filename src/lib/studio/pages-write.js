/**
 * Page writes: create, autosave, publish, restore, delete.
 *
 * Structurally identical to posts-write.js — same two-pointer revision model,
 * same "materialise a draft on first open", same in-place update while a draft
 * is unpublished — with two differences that are the whole reason this is a
 * separate file:
 *
 * ## The stored artifact is bytecode, not markup
 *
 * `page_revisions.html` holds compiled MDX, and rendering an MDX document means
 * evaluating a component. So `savePage` calls `compilePage` rather than
 * `renderMarkdown`, and the value it stores is what `MDXRenderer` hands to
 * `new Function` in the reader's browser. Getting that wrong would not fail
 * loudly — it would 404 the page for every reader.
 *
 * ## A page carries presentation settings that a post does not
 *
 * `giscus_enabled`, `custom_css`, `show_in_nav`, `nav_label`. These live on the
 * `pages` row (they are properties of the page as a URL, not of a version of
 * its text) and are written by the same save.
 */

import { pool } from "../db";
import { renderMarkdown, RENDERER_VERSION } from "../markdown/render";
import { contentDateISO } from "../content/dates";
import { compilePage } from "../content/mdx";
import { readMeta, patchMeta } from "./frontmatter-doc";
import { contentHash, normaliseEol, slugify } from "./revisions";

/**
 * Compile a page for storage.
 *
 * Two artifacts, because a page has two consumers and they need different
 * things. `html` gets the compiled MDX bytecode — the column is "the renderable
 * artifact for this revision", and for an MDX document that artifact is a
 * component, which is what the route renders. `headings` comes from the shared
 * markdown renderer, because the table of contents is derived from markdown
 * structure and the MDX compiler does not report it.
 *
 * Both are produced from the same source at the same moment, which is the only
 * way they cannot disagree about what the revision says.
 */
async function compileForStorage(markdown) {
  const [code, rendered] = await Promise.all([
    compilePage(markdown),
    renderMarkdown(markdown),
  ]);
  return { code: String(code), headings: rendered.headings ?? [] };
}

/**
 * A page as the editor needs it.
 *
 * `html` is deliberately NOT selected here. For a page it is not markup but
 * bytecode — a few hundred kilobytes of compiled JavaScript — and the editor's
 * preview recompiles from source anyway, for the same reason the post editor
 * re-renders: a stored artifact can be stale after a renderer bump, and showing
 * a stale preview is worse than showing none.
 */
const EDIT_SELECT = `
  SELECT p.id, p.slug, p.status, p.giscus_enabled, p.custom_css,
         p.seo_title, p.seo_description, p.og_image,
         p.show_in_nav, p.nav_label, p.published_at, p.updated_at,
         p.draft_revision_id, p.published_revision_id,
         r.id AS revision_id, r.revision_number, r.markdown, r.headings,
         r.title, r.description, r.content_hash, r.renderer_version,
         pub.revision_number AS published_revision_number,
         pub.title AS published_title
    FROM pages p
    LEFT JOIN page_revisions r
      ON r.id = coalesce(p.draft_revision_id, p.published_revision_id)
    LEFT JOIN page_revisions pub
      ON pub.id = p.published_revision_id
   WHERE p.slug = $1
`;

async function withLockedPage(slug, fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(`${EDIT_SELECT} FOR UPDATE OF p`, [
      String(slug).toLowerCase(),
    ]);
    if (!rows.length) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "not_found" };
    }
    const result = await fn(client, rows[0]);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/* ─────────────────────────────── reads ──────────────────────────────────── */

export async function getPageForEdit(slug) {
  const { rows } = await pool.query(EDIT_SELECT, [String(slug).toLowerCase()]);
  return rows[0] ?? null;
}

/**
 * Every page, newest first, for the studio list.
 *
 * `pending` is `draft_revision_id` differing from `published_revision_id` — not
 * merely the draft pointer being non-null. An imported page has both pointers
 * set, to the SAME revision, and reporting that as an unpublished change would
 * mark every page on the site as having edits waiting.
 */
export async function listPagesForStudio() {
  const { rows } = await pool.query(
    `SELECT p.slug, p.status, p.title, p.updated_at, p.published_at,
            p.giscus_enabled, (p.custom_css IS NOT NULL) AS has_custom_css,
            p.show_in_nav, p.nav_label,
            (p.draft_revision_id IS DISTINCT FROM p.published_revision_id) AS pending,
            (SELECT count(*)::int FROM page_revisions r WHERE r.page_id = p.id) AS revisions
       FROM pages p
      WHERE p.status <> 'archived'
      ORDER BY p.updated_at DESC`
  );
  return rows;
}

export async function getPageRevision(pageId, revisionId) {
  const { rows } = await pool.query(
    `SELECT id, revision_number, title, description, markdown, headings,
            renderer_version, content_hash, change_summary, created_at
       FROM page_revisions
      WHERE page_id = $1 AND id = $2`,
    [pageId, revisionId]
  );
  return rows[0] ?? null;
}

export async function listPageRevisions(pageId, { limit = 200 } = {}) {
  const { rows } = await pool.query(
    `SELECT id, revision_number, title, description, renderer_version,
            content_hash, change_summary, created_by, created_at,
            length(markdown) AS markdown_bytes
       FROM page_revisions
      WHERE page_id = $1
      ORDER BY revision_number DESC
      LIMIT $2`,
    [pageId, limit]
  );
  return rows;
}

/* ─────────────────────────────── writes ─────────────────────────────────── */

/**
 * Save a page.
 *
 * `settings` carries the four presentation flags. They are written on the
 * `pages` row rather than into the revision, because they describe the page as
 * a URL — a page restored to an older revision should not suddenly get the old
 * comment setting back. The revision history is about the TEXT.
 */
export async function savePage(
  slug,
  { markdown, meta, settings, userId, summary, forceNewRevision = false }
) {
  const normalised = normaliseEol(markdown);
  const title = String(meta?.title ?? "").trim();
  const description = textOrNull(meta?.description);

  return withLockedPage(slug, async (client, row) => {
    // Materialise a draft on first open — the same bootstrap problem posts
    // have, and for the same reason: /about was imported with only a published
    // revision, so the editor's read would otherwise return a row it must not
    // be allowed to edit in place.
    let draftId = row.draft_revision_id;
    if (!draftId && row.published_revision_id) {
      const copy = await insertRevision(client, {
        pageId: row.id,
        from: row,
        summary: "打开编辑",
        userId,
      });
      await client.query(`UPDATE pages SET draft_revision_id = $2 WHERE id = $1`, [
        row.id,
        copy.id,
      ]);
      draftId = copy.id;
    }

    // The frontmatter carries the title and description so that an export back
    // to a file reproduces the page — and so that readMeta() on the reopened
    // document agrees with what the sidebar showed.
    const document = patchMeta(normalised, {
      title,
      description: description ?? "",
    });

    const documentHash = contentHash(document);

    // `compilePage`, not `renderMarkdown`, for the stored artifact: the column
    // holds bytecode a component can be built from. Compiling here rather than
    // at publish time also means a page whose MDX has a syntax error is
    // rejected while the author is looking at it, with a legible message,
    // rather than at publish time with a stack trace.
    const { code, headings } = await compileForStorage(document);

    const draftIsUnpublished = draftId && draftId !== row.published_revision_id;
    let revisionId;
    let revisionNumber;
    let createdRevision = false;

    if (draftIsUnpublished && !forceNewRevision) {
      const { rows } = await client.query(
        `UPDATE page_revisions
            SET title = $2, description = $3, markdown = $4, html = $5,
                headings = $6, renderer_version = $7, content_hash = $8,
                change_summary = coalesce($9, change_summary)
          WHERE id = $1
          RETURNING id, revision_number`,
        [
          draftId,
          title,
          description,
          document,
          code,
          JSON.stringify(headings ?? []),
          RENDERER_VERSION,
          documentHash,
          summary ?? null,
        ]
      );
      revisionId = rows[0].id;
      revisionNumber = rows[0].revision_number;
    } else {
      const rev = await insertRevision(client, {
        pageId: row.id,
        from: {
          title,
          description,
          markdown: document,
          html: code,
          headings,
          renderer_version: RENDERER_VERSION,
          content_hash: documentHash,
        },
        summary: summary ?? "编辑",
        userId,
      });
      revisionId = rev.id;
      revisionNumber = rev.revision_number;
      createdRevision = true;
      await client.query(`UPDATE pages SET draft_revision_id = $2 WHERE id = $1`, [
        row.id,
        revisionId,
      ]);
    }

    // The presentation settings, on the page row.
    const giscus =
      settings?.giscusEnabled === undefined
        ? row.giscus_enabled
        : settings.giscusEnabled === true;
    const customCss =
      settings?.customCss === undefined ? row.custom_css : textOrNull(settings.customCss);
    const showInNav =
      settings?.showInNav === undefined ? row.show_in_nav : settings.showInNav === true;
    const navLabel =
      settings?.navLabel === undefined ? row.nav_label : textOrNull(settings.navLabel);

    await client.query(
      `UPDATE pages
          SET giscus_enabled = $2,
              custom_css = $3,
              show_in_nav = $4,
              nav_label = $5,
              updated_at = now()
        WHERE id = $1`,
      [row.id, giscus, customCss, showInNav, navLabel]
    );

    // The nav row, in the SAME transaction as the flag that describes it. A
    // page whose `show_in_nav` is true and whose nav entry is missing is a
    // broken state, and the only way two writes cannot drift apart is if they
    // are one write. The two directions are not symmetrical — see
    // src/lib/studio/nav.js for why turning it off removes the row but turning
    // it on leaves an existing one alone.
    // Unconditional: `showInNav` has a value whether or not the caller passed
    // one (it falls back to the row's current flag), so this is an assertion of
    // the current state rather than a change — and asserting is idempotent.
    const nav = await syncNavRow(client, {
      slug: row.slug,
      show: showInNav,
      label: navLabel || title || row.slug,
    });

    return {
      ok: true,
      changed: documentHash !== row.content_hash || createdRevision,
      revisionId,
      revisionNumber,
      hash: documentHash,
      navChanged: nav.changed === true,
      // No rendered HTML in the response: a page's preview is produced by
      // compiling, which the client does not do. The editor refetches instead.
      markdown: document,
    };
  });
}

/** Publish the current draft page. */
export async function publishPage(slug, { userId, publishedAt } = {}) {
  return withLockedPage(slug, async (client, row) => {
    if (!row.draft_revision_id) return { ok: false, reason: "no_draft" };
    if (row.draft_revision_id === row.published_revision_id) {
      return { ok: false, reason: "no_changes" };
    }
    if (!row.title || !String(row.title).trim()) {
      return { ok: false, reason: "no_title" };
    }

    const effectiveDate =
      contentDateISO(publishedAt) ??
      (row.published_at
        ? new Date(row.published_at).toISOString()
        : new Date().toISOString());

    await client.query(
      `UPDATE pages
          SET published_revision_id = $2,
              status = 'published',
              published_at = $3,
              updated_at = now()
        WHERE id = $1`,
      [row.id, row.draft_revision_id, effectiveDate]
    );

    await client.query(
      `UPDATE page_revisions SET change_summary = coalesce(change_summary, '发布')
        WHERE id = $1`,
      [row.draft_revision_id]
    );

    return {
      ok: true,
      slug: row.slug,
      pageId: row.id,
      revisionId: row.draft_revision_id,
      revisionNumber: row.revision_number,
      publishedAt: effectiveDate,
      firstPublication: row.published_at === null,
    };
  });
}

export async function unpublishPage(slug) {
  return withLockedPage(slug, async (client, row) => {
    if (row.status !== "published") return { ok: false, reason: "not_published" };
    await client.query(
      `UPDATE pages SET status = 'draft', updated_at = now() WHERE id = $1`,
      [row.id]
    );
    return { ok: true, slug: row.slug, pageId: row.id };
  });
}

/**
 * Restore a historical revision as the new draft — a copy, never a pointer
 * move, for the reason spelled out in posts-write.js.
 */
export async function restorePageRevision(slug, revisionId, { userId } = {}) {
  return withLockedPage(slug, async (client, row) => {
    const { rows } = await client.query(
      `SELECT * FROM page_revisions WHERE page_id = $1 AND id = $2`,
      [row.id, revisionId]
    );
    if (!rows.length) return { ok: false, reason: "not_found" };

    const source = rows[0];
    const copy = await insertRevision(client, {
      pageId: row.id,
      from: source,
      summary: `恢复自 r${source.revision_number}`,
      userId,
    });

    await client.query(
      `UPDATE pages SET draft_revision_id = $2, updated_at = now() WHERE id = $1`,
      [row.id, copy.id]
    );

    return {
      ok: true,
      revisionId: copy.id,
      revisionNumber: copy.revision_number,
      restoredFrom: source.revision_number,
    };
  });
}

/**
 * Create a page.
 *
 * Unlike a post, a page's slug is the URL a reader types — `/about` — so it is
 * derived from the title and is expected to be edited by hand. A Chinese title
 * slugifies to "" and gets a timestamp, which is ugly for a page in a way it is
 * not for a post: a page IS its slug.
 */
export async function createPage({ title = "新页面", slug: requested } = {}) {
  const slug = await uniqueSlug(slugify(requested || title));
  const markdown = `---\ntitle: ${JSON.stringify(title)}\n---\n\n`;
  const { code, headings } = await compilePage(markdown);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: pageRows } = await client.query(
      `INSERT INTO pages (slug, status, giscus_enabled) VALUES ($1, 'draft', true)
       RETURNING id`,
      [slug]
    );
    const pageId = pageRows[0].id;

    const { rows: revRows } = await client.query(
      `INSERT INTO page_revisions
         (page_id, revision_number, title, description, markdown, html, headings,
          renderer_version, content_hash, change_summary)
       VALUES ($1, 1, $2, NULL, $3, $4, $5, $6, $7, '新建页面')
       RETURNING id`,
      [
        pageId,
        title,
        markdown,
        code,
        JSON.stringify(headings ?? []),
        RENDERER_VERSION,
        contentHash(markdown),
      ]
    );

    await client.query(`UPDATE pages SET draft_revision_id = $2 WHERE id = $1`, [
      pageId,
      revRows[0].id,
    ]);

    await client.query("COMMIT");
    return { ok: true, id: pageId, slug };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Delete a page.
 *
 * The nav row goes with it, and it is removed explicitly rather than by a
 * cascade: `nav_items` has a nullable `page_slug` pointer (0010), and "the page
 * is gone" should remove the link rather than leave the header pointing at a
 * 404. The search row goes too — a page that no longer exists must not appear in
 * results.
 *
 * The slug is NOT automatically redirected afterwards. A rename has an obvious
 * destination — wherever the page went — and gets one for free; a delete does
 * not, and inventing a target (the home page? the blog?) would be the studio
 * deciding what a URL should mean. The page list offers to record one, and any
 * destination the author names is written through the same `redirects` table.
 */
export async function deletePage(slug) {
  const clean = String(slug).toLowerCase();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `DELETE FROM pages WHERE slug = $1 RETURNING id`,
      [clean]
    );
    if (rows.length) {
      await client.query(`DELETE FROM nav_items WHERE page_slug = $1`, [clean]);
      await client.query(`DELETE FROM search_index WHERE id = $1`, [`page:${clean}`]);
    }
    await client.query("COMMIT");
    return { ok: rows.length === 1, pageId: rows[0]?.id ?? null };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Rename a page's slug, moving its pointers with it.
 *
 * Three things reference a page by slug and all three have to move in one
 * transaction, or the site spends a moment — or forever, if one fails — in a
 * state where the navigation and the redirect table disagree with the page:
 *
 *   nav_items.page_slug       the entry's owner
 *   nav_items.href            where the header actually links
 *   search_index.url          where a search result points
 *
 * The `page_revisions` and `pages.draft_revision_id` FKs address the page by
 * id, so they need nothing.
 */
export async function changePageSlug(slug, nextSlug) {
  const clean = slugify(nextSlug) || String(nextSlug).trim().replace(/^\/+/, "");
  const previous = String(slug).toLowerCase();

  return withLockedPage(previous, async (client, row) => {
    if (clean === row.slug) return { ok: true, slug: clean, unchanged: true };

    const clash = await client.query(`SELECT 1 FROM pages WHERE slug = $1`, [clean]);
    if (clash.rows.length) return { ok: false, reason: "duplicate" };

    await client.query(`UPDATE pages SET slug = $2, updated_at = now() WHERE id = $1`, [
      row.id,
      clean,
    ]);

    await client.query(
      `UPDATE nav_items SET href = $2, page_slug = $3 WHERE page_slug = $1`,
      [previous, `/${clean}`, clean]
    );

    // Guarded by existence rather than an ON CONFLICT: the search row may not
    // exist at all for a page that has never been published, and an INSERT
    // would then create an index entry for a URL that 404s.
    await client.query(
      `UPDATE search_index
          SET url = $2, updated_at = now()
        WHERE id = $1`,
      [`page:${previous}`, `/${clean}`]
    );
    await client.query(`UPDATE search_index SET id = $2 WHERE id = $1`, [
      `page:${previous}`,
      `page:${clean}`,
    ]);

    return { ok: true, slug: clean, previous };
  });
}

/* ────────────────────────────── helpers ─────────────────────────────────── */

function textOrNull(value) {
  const text = value === null || value === undefined ? "" : String(value).trim();
  return text === "" ? null : text;
}

/**
 * Keep `nav_items` in step with `pages.show_in_nav`.
 *
 * In the same transaction as the flag, and taking the client rather than the
 * pool for exactly that reason. The two directions differ on purpose:
 *
 *   show = true   → create a row only if there is not one already. If there IS
 *                   one it is left untouched, because the author may have
 *                   renamed or reordered it and re-asserting the page title on
 *                   every autosave would silently undo that.
 *
 *   show = false  → remove the row. Symmetric, because "show this page in the
 *                   navigation" being false while the page is in the navigation
 *                   makes the switch a lie.
 *
 * A row that should exist but be hidden is what `nav_items.visible` is for, and
 * it is set in the studio's navigation editor — not by this switch. One boolean
 * per fact.
 */
async function syncNavRow(client, { slug, show, label }) {
  const { rows: existing } = await client.query(
    `SELECT id FROM nav_items WHERE page_slug = $1 LIMIT 1`,
    [slug]
  );

  if (!show) {
    if (!existing.length) return { changed: false };
    await client.query(`DELETE FROM nav_items WHERE id = $1`, [existing[0].id]);
    return { changed: true };
  }

  if (existing.length) return { changed: false };

  await client.query(
    `INSERT INTO nav_items (label, href, external, visible, sort_order, page_slug)
     VALUES ($1, $2, false, true,
             coalesce((SELECT max(sort_order) + 1 FROM nav_items), 0),
             $3)`,
    [label || slug, `/${slug}`, slug]
  );
  return { changed: true };
}

async function insertRevision(client, { pageId, from, summary, userId }) {
  const { rows: n } = await client.query(
    `SELECT coalesce(max(revision_number), 0) + 1 AS n
       FROM page_revisions WHERE page_id = $1`,
    [pageId]
  );

  const { rows } = await client.query(
    `INSERT INTO page_revisions
       (page_id, revision_number, title, description, markdown, html, headings,
        renderer_version, content_hash, change_summary, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING id, revision_number`,
    [
      pageId,
      n[0].n,
      from.title,
      from.description,
      from.markdown,
      from.html,
      JSON.stringify(from.headings ?? []),
      from.renderer_version ?? RENDERER_VERSION,
      from.content_hash,
      summary ?? null,
      userId ?? null,
    ]
  );
  return rows[0];
}

async function uniqueSlug(base) {
  const seed =
    base ||
    `page-${new Date().toISOString().slice(0, 10)}-${Math.random()
      .toString(36)
      .slice(2, 7)}`;

  let candidate = seed;
  for (let i = 0; i < 50; i++) {
    const { rows } = await pool.query(`SELECT 1 FROM pages WHERE slug = $1`, [candidate]);
    if (!rows.length) return candidate;
    candidate = `${seed}-${i + 2}`;
  }
  return `${seed}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Headings and reading time are not stored for pages; the TOC reads headings. */
export async function previewPage(markdown) {
  const { headings } = await renderMarkdown(String(markdown ?? ""));
  return { headings };
}

export { readMeta };
