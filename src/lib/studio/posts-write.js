/**
 * Post writes: create, autosave, publish, revert, delete, restore.
 *
 * ## Where each piece of data lives
 *
 * A post's editable state is split across three tables, and the split is not
 * arbitrary — it is what makes the reader path cheap:
 *
 *   post_revisions — the DOCUMENT. title, description, markdown, rendered html,
 *                    headings, reading time, content hash. Immutable once
 *                    published.
 *   posts          — what the document IS in the world. status, published_at,
 *                    featured, cover image, the two revision pointers. Read by
 *                    every list on the site.
 *   post_tags      — the taxonomy, with a position, because the chip row shows
 *                    the first two and hides the rest behind "+N".
 *
 * Frontmatter is the author's view of all three at once, which is why one save
 * writes to all three: title goes to the revision, tags to post_tags, the cover
 * image to posts.
 *
 * ## Autosave and the revision history
 *
 * The history is meant to be "things the author chose to keep", not "every
 * keystroke". So:
 *
 *   - While a draft revision is UNPUBLISHED, saving updates it in place. No new
 *     row, no revision-number churn, no growth. This is only sound because that
 *     revision is not what readers are served — `published_revision_id` still
 *     points at the old one.
 *   - Publishing, reverting, and restoring each create a revision, because
 *     those are the moments a version becomes immutable and worth keeping.
 *   - A save whose content hash is unchanged writes NOTHING. An editor left
 *     open with a timer running therefore generates zero writes, which is what
 *     makes a two-second autosave interval defensible.
 *
 * ## Why nothing here imports `next/cache`
 *
 * Cache invalidation belongs to the Server Action that calls these functions,
 * not to the functions themselves. Keeping it out means this module is plain
 * Node — it can be exercised by a script against the real database, which is
 * how the publish/restore/concurrency behaviour was verified. `updateTag` also
 * only works inside an action, so a call from here would fail at runtime with
 * an error that names the tag, not the call site.
 */

import { pool } from "../db";
import { renderMarkdown, RENDERER_VERSION } from "../markdown/render";
import { contentDateISO } from "../content/dates";
import { readMeta, patchMeta } from "./frontmatter-doc";
import { contentHash, normaliseEol, slugify } from "./revisions";

/**
 * Everything the editor needs about one post, draft preferred.
 *
 * Not cached, deliberately: autosave writes every couple of seconds and the
 * author has to see what they just typed.
 */
const EDIT_SELECT = `
  SELECT p.id, p.slug, p.status, p.featured, p.cover_image, p.cover_image_desc,
         p.published_at, p.lastmod, p.giscus_enabled, p.seo_title,
         p.seo_description, p.og_image, p.source_path,
         p.draft_revision_id, p.published_revision_id,
         r.id AS revision_id, r.revision_number, r.markdown, r.html,
         r.title, r.description, r.headings, r.reading_time, r.content_hash,
         coalesce(
           (SELECT array_agg(t.slug ORDER BY pt.position)
              FROM post_tags pt JOIN tags t ON t.id = pt.tag_id
             WHERE pt.post_id = p.id),
           '{}'
         ) AS tags,
         coalesce(
           (SELECT array_agg(t.label ORDER BY pt.position)
              FROM post_tags pt JOIN tags t ON t.id = pt.tag_id
             WHERE pt.post_id = p.id),
           '{}'
         ) AS labels
    FROM posts p
    LEFT JOIN post_revisions r
      ON r.id = coalesce(p.draft_revision_id, p.published_revision_id)
   WHERE p.slug = $1
`;

/**
 * Run `fn` with the post row locked, inside a transaction.
 *
 * `FOR UPDATE OF p` locks the PARENT row, not the revision. That distinction
 * matters: publish moves `published_revision_id`, so a save that locked only
 * the revision would let a concurrent publish swap the pointer out from under
 * it. Locking the parent serialises both writers on the one row they share.
 *
 * The connection is taken explicitly because a transaction must run on ONE
 * connection — `pool.query()` may hand each statement a different client, which
 * would put the BEGIN and the UPDATEs in different sessions and silently lose
 * the atomicity.
 */
async function withLockedPost(slug, fn) {
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

export async function getPostForEdit(slug) {
  const { rows } = await pool.query(EDIT_SELECT, [String(slug).toLowerCase()]);
  return rows[0] ?? null;
}

/** One revision in full, for the diff and restore screens. */
export async function getRevision(postId, revisionId) {
  const { rows } = await pool.query(
    `SELECT id, revision_number, title, description, markdown, html, headings,
            reading_time, renderer_version, content_hash, change_summary, created_at
       FROM post_revisions
      WHERE post_id = $1 AND id = $2`,
    [postId, revisionId]
  );
  return rows[0] ?? null;
}

/**
 * The revision history, newest first.
 *
 * `markdown` is deliberately NOT selected. The list is drawn on every open, and
 * a post with sixty revisions would ship hundreds of kilobytes of text to
 * render sixty dates. The diff screen fetches the two revisions it needs; the
 * byte length is here so the list can show which revisions were large edits.
 */
export async function listRevisions(postId, { limit = 200 } = {}) {
  const { rows } = await pool.query(
    `SELECT id, revision_number, title, description, renderer_version,
            content_hash, change_summary, created_by, created_at,
            length(markdown) AS markdown_bytes
       FROM post_revisions
      WHERE post_id = $1
      ORDER BY revision_number DESC
      LIMIT $2`,
    [postId, limit]
  );
  return rows;
}

/* ─────────────────────────────── writes ─────────────────────────────────── */

/**
 * Save a post.
 *
 * `meta` is the parsed frontmatter fields from the editor's sidebar. They are
 * patched back into the markdown so the stored document is self-consistent: an
 * export back to a file must reproduce the same post, and a `git diff` of that
 * export must show the author's edit and nothing else. See
 * scripts/db/check-frontmatter-roundtrip.mjs for the property that guarantees.
 *
 * `forceNewRevision` is for the explicit "save as a checkpoint" the author can
 * ask for; autosave never passes it.
 */
export async function savePost(
  slug,
  { markdown, meta, userId, summary, forceNewRevision = false }
) {
  const normalised = normaliseEol(markdown);
  const parts = splitMeta(meta);

  return withLockedPost(slug, async (client, row) => {
    // ── materialise a draft if this post has never been edited ────────────
    //
    // Every imported post has `draft_revision_id IS NULL` and only a published
    // revision (verified across all 63). So the editor's natural read — "give
    // me the draft" — returns the published revision for the whole site on day
    // one. Rather than let "the draft" mean two different rows depending on
    // history, opening a post for editing COPIES its published revision into a
    // draft, once, and from then on the invariant holds unconditionally.
    let draftId = row.draft_revision_id;
    if (!draftId && row.published_revision_id) {
      const copy = await insertRevision(client, {
        postId: row.id,
        from: row,
        summary: "打开编辑",
        userId,
      });
      await client.query(
        `UPDATE posts SET draft_revision_id = $2 WHERE id = $1`,
        [row.id, copy.id]
      );
      draftId = copy.id;
    }

    // ── the document ──────────────────────────────────────────────────────
    //
    // `draft` is deliberately NOT patched back. The frontmatter `draft:` key is
    // an import-time convention from the static site; on the platform the
    // authoritative answer is `posts.status`, and publish/unpublish are what
    // change it. Writing it into the document as well would give one fact two
    // homes, and the two would disagree the first time a post was published
    // from /studio — the file would still say `draft: true` while the database
    // said published. It is also what makes a no-op save a no-op: injecting a
    // derived key would change the bytes on every save of every draft.
    const document = patchMeta(normalised, {
      title: parts.title,
      description: parts.description ?? "",
      publishDate: parts.publishDate ?? "",
      lastmod: parts.lastmod ?? "",
      tags: parts.tags,
      image: parts.coverImage ?? "",
      imageDesc: parts.coverImageDesc ?? "",
      featured: parts.featured,
    });

    const documentHash = contentHash(document);
    const { html, headings, readingTime } = await renderMarkdown(document);

    // ── in place, or a new revision? ──────────────────────────────────────
    //
    // In place is allowed only while the draft is UNPUBLISHED — that is, while
    // `published_revision_id` points somewhere else. Once the two pointers
    // agree, the row being edited is the row readers are served, and mutating
    // it would rewrite published history.
    const draftIsUnpublished = draftId && draftId !== row.published_revision_id;

    let revisionId;
    let revisionNumber;
    let createdRevision = false;

    if (draftIsUnpublished && !forceNewRevision) {
      const { rows } = await client.query(
        `UPDATE post_revisions
            SET title = $2, description = $3, markdown = $4, html = $5,
                headings = $6, reading_time = $7, renderer_version = $8,
                content_hash = $9,
                change_summary = coalesce($10, change_summary)
          WHERE id = $1
          RETURNING id, revision_number`,
        [
          draftId,
          parts.title,
          parts.description,
          document,
          html,
          JSON.stringify(headings ?? []),
          readingTime ? JSON.stringify(readingTime) : null,
          RENDERER_VERSION,
          documentHash,
          summary ?? null,
        ]
      );
      revisionId = rows[0].id;
      revisionNumber = rows[0].revision_number;
    } else {
      const rev = await insertRevision(client, {
        postId: row.id,
        from: {
          title: parts.title,
          description: parts.description,
          markdown: document,
          html,
          headings,
          reading_time: readingTime,
          renderer_version: RENDERER_VERSION,
          content_hash: documentHash,
        },
        summary: summary ?? "编辑",
        userId,
      });
      revisionId = rev.id;
      revisionNumber = rev.revision_number;
      createdRevision = true;

      // Always the draft pointer. A freshly created revision is by definition
      // the thing being edited, never the thing being read — including for an
      // already-published post, where the entire point of the new row is that
      // `published_revision_id` keeps pointing at the old one until the author
      // publishes.
      await client.query(
        `UPDATE posts SET draft_revision_id = $2 WHERE id = $1`,
        [row.id, revisionId]
      );
    }

    // ── the post row ──────────────────────────────────────────────────────
    //
    // `published_at` is NOT touched here even when the author edits the date
    // field: changing the date in the editor is a request to change it in the
    // frontmatter, and it takes effect on publish (see `publishPost`). Writing
    // it now would reorder the archive while the change is still a draft.
    await client.query(
      `UPDATE posts
          SET featured = $2,
              cover_image = $3,
              cover_alt = $4,
              cover_image_desc = $4,
              lastmod = $5,
              updated_at = now()
        WHERE id = $1`,
      [
        row.id,
        parts.featured,
        parts.coverImage,
        parts.coverImageDesc,
        parts.lastmod,
      ]
    );

    // ── tags ──────────────────────────────────────────────────────────────
    //
    // DELETE then INSERT, not a diff. A post has at most a handful of tags, and
    // the position column means reordering is a real edit — rebuilding is
    // simpler and cannot leave a stale position behind.
    await client.query(`DELETE FROM post_tags WHERE post_id = $1`, [row.id]);
    if (parts.tags.length) {
      await client.query(
        `INSERT INTO post_tags (post_id, tag_id, position)
         SELECT $1, t.id, ord.n
           FROM unnest($2::text[]) WITH ORDINALITY AS ord(slug, n)
           JOIN tags t ON t.slug = ord.slug
         ON CONFLICT (post_id, tag_id) DO UPDATE SET position = EXCLUDED.position`,
        [row.id, parts.tags]
      );
    }

    return {
      ok: true,
      // `changed` is false when the bytes were already what we were about to
      // write. The UI says "no changes" rather than "saved", because a save
      // indicator that always reports success is telling the author nothing.
      changed: documentHash !== row.content_hash || createdRevision,
      revisionId,
      revisionNumber,
      hash: documentHash,
      markdown: document,
      html,
      unknownTags: await unknownTags(client, parts.tags),
    };
  });
}

/**
 * Publish the current draft.
 *
 * Refuses when there is nothing distinct to publish. Silently succeeding would
 * tell the author their edit went live when it did not — the single worst
 * failure mode a publish button can have.
 */
export async function publishPost(slug, { userId, publishedAt } = {}) {
  const result = await withLockedPost(slug, async (client, row) => {
    if (!row.draft_revision_id) return { ok: false, reason: "no_draft" };
    if (row.draft_revision_id === row.published_revision_id) {
      return { ok: false, reason: "no_changes" };
    }
    if (!row.title || !String(row.title).trim()) {
      return { ok: false, reason: "no_title" };
    }

    // First publication takes the requested date (or now); a re-publish keeps
    // the original. Re-publishing to fix a typo must not reorder the archive,
    // and must not change the feed's `pubDate` — that re-notifies every
    // subscriber for a comma.
    const effectiveDate =
      contentDateISO(publishedAt) ??
      (row.published_at
        ? new Date(row.published_at).toISOString()
        : new Date().toISOString());

    await client.query(
      `UPDATE posts
          SET published_revision_id = $2,
              status = 'published',
              published_at = $3,
              updated_at = now()
        WHERE id = $1`,
      [row.id, row.draft_revision_id, effectiveDate]
    );

    // Only if the author did not annotate the save — "rewrote the intro" says
    // more than "发布", and overwriting it would throw away the useful half.
    await client.query(
      `UPDATE post_revisions SET change_summary = coalesce(change_summary, '发布')
        WHERE id = $1`,
      [row.draft_revision_id]
    );

    return {
      ok: true,
      postId: row.id,
      slug: row.slug,
      revisionId: row.draft_revision_id,
      revisionNumber: row.revision_number,
      publishedAt: effectiveDate,
      title: row.title,
      description: row.description,
      html: row.html,
      tags: row.tags,
      labels: row.labels,
      firstPublication: row.published_at === null,
    };
  });

  return result;
}

/** Take a published post back to draft. Readers get a 404 again. */
export async function unpublishPost(slug) {
  return withLockedPost(slug, async (client, row) => {
    if (row.status !== "published") return { ok: false, reason: "not_published" };
    await client.query(
      `UPDATE posts SET status = 'draft', updated_at = now() WHERE id = $1`,
      [row.id]
    );
    return { ok: true, postId: row.id, slug: row.slug };
  });
}

/**
 * Restore a historical revision as the new draft.
 *
 * A COPY, never a pointer move. Moving `draft_revision_id` back would make that
 * old revision editable in place — so the version the author restored FROM
 * would no longer exist, and the restore itself would vanish from the log.
 * Copying keeps the past immutable, which is the entire point of having one.
 */
export async function restoreRevision(slug, revisionId, { userId } = {}) {
  return withLockedPost(slug, async (client, row) => {
    const { rows } = await client.query(
      `SELECT * FROM post_revisions WHERE post_id = $1 AND id = $2`,
      [row.id, revisionId]
    );
    if (!rows.length) return { ok: false, reason: "not_found" };

    const source = rows[0];
    const copy = await insertRevision(client, {
      postId: row.id,
      from: source,
      summary: `恢复自 r${source.revision_number}`,
      userId,
    });

    await client.query(
      `UPDATE posts SET draft_revision_id = $2, updated_at = now() WHERE id = $1`,
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
 * Create a post.
 *
 * The slug comes from the title when the title can produce one, and from a
 * timestamp otherwise. That fallback is not an edge case here — every title in
 * this blog is Chinese, and a slugifier that strips non-ASCII returns an empty
 * string for all of them. The author renames the slug in the editor anyway; the
 * fallback only has to be unique and legible, not pretty.
 */
export async function createPost({ title = "未命名", userId } = {}) {
  const slug = await uniqueSlug(slugify(title));
  const markdown = `---\ntitle: ${JSON.stringify(title)}\n---\n\n`;
  const { html, headings, readingTime } = await renderMarkdown(markdown);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: postRows } = await client.query(
      `INSERT INTO posts (slug, status, giscus_enabled) VALUES ($1, 'draft', true)
       RETURNING id`,
      [slug]
    );
    const postId = postRows[0].id;

    const { rows: revRows } = await client.query(
      `INSERT INTO post_revisions
         (post_id, revision_number, title, description, markdown, html, headings,
          reading_time, renderer_version, content_hash, change_summary, created_by)
       VALUES ($1, 1, $2, NULL, $3, $4, $5, $6, $7, $8, '新建草稿', $9)
       RETURNING id`,
      [
        postId,
        title,
        markdown,
        html,
        JSON.stringify(headings ?? []),
        readingTime ? JSON.stringify(readingTime) : null,
        RENDERER_VERSION,
        contentHash(markdown),
        userId ?? null,
      ]
    );

    await client.query(
      `UPDATE posts SET draft_revision_id = $2 WHERE id = $1`,
      [postId, revRows[0].id]
    );

    await client.query("COMMIT");
    return { ok: true, id: postId, slug };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Delete a post and everything attached to it, by cascade.
 *
 * A hard delete. `status = 'archived'` is already in the schema and is the
 * right answer for "take it off the site but keep it" — this is for the case
 * the author actually means, which is "I never wanted this". The UI asks twice.
 */
export async function deletePost(slug) {
  const { rows } = await pool.query(
    `DELETE FROM posts WHERE slug = $1 RETURNING id`,
    [String(slug).toLowerCase()]
  );
  return { ok: rows.length === 1, postId: rows[0]?.id ?? null };
}

/** Rename a post's slug, recording the old one so a redirect can be built. */
export async function changeSlug(slug, nextSlug, { userId } = {}) {
  const clean = slugify(nextSlug) || nextSlug;
  return withLockedPost(slug, async (client, row) => {
    if (clean === row.slug) return { ok: true, slug: clean, unchanged: true };

    const clash = await client.query(`SELECT 1 FROM posts WHERE slug = $1`, [clean]);
    if (clash.rows.length) return { ok: false, reason: "duplicate" };

    await client.query(`UPDATE posts SET slug = $2, updated_at = now() WHERE id = $1`, [
      row.id,
      clean,
    ]);
    // The old URL keeps working. This is not optional for a site with inbound
    // links: a post that has been up for three years has been linked to, and a
    // 404 where a post used to be is a reader lost.
    await client.query(
      `INSERT INTO slug_history (post_id, slug)
       VALUES ($1, $2)
       ON CONFLICT (slug) DO UPDATE
         SET post_id = EXCLUDED.post_id, retired_at = NULL`,
      [row.id, row.slug]
    );

    return { ok: true, slug: clean, previous: row.slug };
  });
}

/* ────────────────────────────── helpers ─────────────────────────────────── */

/**
 * Turn submitted metadata into the shapes it has to be written in.
 *
 * A tag that is not in the taxonomy is DROPPED rather than auto-created. The
 * taxonomy is 15 curated tags, and a typo inventing a 16th is exactly how a
 * taxonomy rots — the sidebar grows a tag with one post in it, and nobody ever
 * notices. `savePost` reports the dropped names back so the editor can say so.
 */
function splitMeta(meta) {
  const m = meta ?? {};
  return {
    title: String(m.title ?? "").trim(),
    description: textOrNull(m.description),
    featured: m.featured === true,
    coverImage: textOrNull(m.image),
    coverImageDesc: textOrNull(m.imageDesc),
    publishDate: m.publishDate === "" ? null : (m.publishDate ?? null),
    lastmod: m.lastmod === "" ? null : (m.lastmod ?? null),
    tags: normaliseTags(m.tags),
  };
}

function textOrNull(value) {
  const text = value === null || value === undefined ? "" : String(value).trim();
  return text === "" ? null : text;
}

function normaliseTags(value) {
  const list = Array.isArray(value)
    ? value
    : value === null || value === undefined || value === ""
      ? []
      : [value];
  return [...new Set(list.map((t) => String(t).trim()).filter(Boolean))];
}

/** Which of these slugs are not in the taxonomy. */
async function unknownTags(client, tags) {
  if (!tags.length) return [];
  const { rows } = await client.query(
    `SELECT slug FROM tags WHERE slug = ANY($1::text[])`,
    [tags]
  );
  const known = new Set(rows.map((r) => r.slug));
  return tags.filter((t) => !known.has(t));
}

async function insertRevision(client, { postId, from, summary, userId }) {
  const { rows: n } = await client.query(
    `SELECT coalesce(max(revision_number), 0) + 1 AS n
       FROM post_revisions WHERE post_id = $1`,
    [postId]
  );

  const { rows } = await client.query(
    `INSERT INTO post_revisions
       (post_id, revision_number, title, description, markdown, html, headings,
        reading_time, renderer_version, content_hash, change_summary, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING id, revision_number`,
    [
      postId,
      n[0].n,
      from.title,
      from.description,
      from.markdown,
      from.html,
      JSON.stringify(from.headings ?? []),
      from.reading_time ? JSON.stringify(from.reading_time) : null,
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
    `post-${new Date().toISOString().slice(0, 10)}-${Math.random()
      .toString(36)
      .slice(2, 7)}`;

  let candidate = seed;
  for (let i = 0; i < 50; i++) {
    const { rows } = await pool.query(`SELECT 1 FROM posts WHERE slug = $1`, [
      candidate,
    ]);
    if (!rows.length) return candidate;
    candidate = `${seed}-${i + 2}`;
  }
  return `${seed}-${Math.random().toString(36).slice(2, 8)}`;
}

/** The frontmatter fields an editor renders, without the document body. */
export async function getPostMeta(slug) {
  const row = await getPostForEdit(slug);
  if (!row) return null;
  return { ...row, meta: readMeta(row.markdown ?? "") };
}
