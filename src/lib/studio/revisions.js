/**
 * Small primitives shared by the post and page write paths.
 *
 * Posts and pages store revisions identically — a row plus an append-only
 * history, with two pointers on the parent — so the parts that only touch that
 * shape live here rather than being written twice and drifting apart.
 *
 * ## The pointer model, stated once
 *
 *   draft_revision_id     — what the editor is working on.
 *   published_revision_id — what a reader sees.
 *
 * A revision is immutable once it has been PUBLISHED. While the draft pointer
 * names a revision that the published pointer does not, that row may be updated
 * in place — which is what makes autosave one UPDATE instead of a new row every
 * two seconds, and keeps "revision history" meaning "versions worth keeping"
 * rather than "every keystroke".
 *
 * The invariant is therefore: `draft === published` means "not editing", and
 * `draft !== published` means "there is an unpublished change". Every write
 * path branches on exactly that.
 */

import { createHash } from "node:crypto";

/**
 * SHA-256 of the markdown source, hex.
 *
 * The definition is not arbitrary. Migration 0002's backfill computed
 * `encode(sha256(convert_to(markdown,'UTF8')),'hex')`, and the importer
 * (scripts/db/import-posts.mjs) computes the same thing in Node. Autosave uses
 * this value to decide whether a save is a no-op, so if it disagreed with
 * either of those by so much as an encoding detail, every save would look like
 * a change and the history would fill with identical rows.
 *
 * LF, always: callers pass markdown that `normaliseEol` has already been
 * through, and the importer does the same at its boundary. A CRLF checkout of
 * an unchanged file must not hash differently from the LF bytes already in the
 * database.
 */
export function contentHash(markdown) {
  return createHash("sha256").update(String(markdown ?? ""), "utf8").digest("hex");
}

/** Short prefix, for showing a hash in the UI without 64 characters of noise. */
export function shortHash(hash) {
  return String(hash ?? "").slice(0, 7);
}

/**
 * Normalise line endings to LF.
 *
 * Every writer calls this before hashing or storing, for the same reason the
 * importer does: a `\r` inside a `<p>` is invisible in a browser and is literal
 * junk in a feed, a search snippet, or a copy-paste. Doing it at the storage
 * boundary means the canonical form is the only form that exists downstream.
 */
export function normaliseEol(text) {
  return String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * The next revision number for an item, read inside the caller's transaction.
 *
 * `max + 1`. Two concurrent saves of the same document are impossible in
 * practice — one author, one editor — but the `UNIQUE (…, revision_number)`
 * constraint makes them impossible to corrupt: the second writer gets a
 * constraint violation rather than two revisions sharing a number.
 */
export async function nextRevisionNumber(client, table, idColumn, id) {
  const { rows } = await client.query(
    `SELECT coalesce(max(revision_number), 0) + 1 AS n
       FROM ${table}
      WHERE ${idColumn} = $1`,
    [id]
  );
  return rows[0].n;
}

/**
 * Whether the pointer pair is in the "editing an unpublished draft" state.
 *
 * The one place that decides whether a save may update in place. Stated as a
 * named predicate because getting it backwards is the kind of bug that silently
 * rewrites published history.
 */
export function isDraftMutable(row) {
  return Boolean(
    row.draft_revision_id && row.draft_revision_id !== row.published_revision_id
  );
}

/**
 * A URL-safe slug.
 *
 * Latin and digits survive; everything else collapses to a hyphen. A CJK title
 * therefore produces "" — which is the expected path for this blog, not a bug:
 * every title here is Chinese, and the author renames the slug in the editor.
 * The fallback only has to be unique and legible.
 */
export function slugify(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
