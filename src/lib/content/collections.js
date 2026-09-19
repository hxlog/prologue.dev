/**
 * Collection reads.
 *
 * A collection is a user-defined content type — microblog, friend links,
 * portfolio, film log — with its own fields, defined in /studio rather than in
 * YAML. Field values live in `collection_entries.values` as JSONB keyed by
 * `collection_fields.key`, so adding a field is an INSERT, never a migration.
 *
 * There is no public URL for a collection and none is generated. A page reads
 * one named collection and renders it with its own component, which is why
 * every function here is "this collection, in this order" rather than a generic
 * query builder: /microblog renders with the microblog card, /links with the
 * friend-link row, and neither wants the other's shape.
 *
 * CACHING: `getCollectionEntries` and everything built on it are tagged
 * `collection:<slug>`, so editing one entry in the microblog does not evict the
 * friend-links page. `getCollection` — the schema read — is tagged too, because
 * adding a field changes it, but NOT by entry writes; that is a different tag
 * (`collection:<slug>:schema`) so a new microblog post does not rebuild the
 * field list for the editor.
 *
 * `listCollections` is for /studio's sidebar and is not cached.
 */

import { cacheLife, cacheTag } from "next/cache";
import { queryOne, queryMany } from "../db";

/** One collection, with its field definitions in display order. */
export async function getCollection(slug) {
  "use cache";
  cacheLife("max");
  cacheTag(`collection:${slug}:schema`);

  const collection = await queryOne(
    `SELECT id, slug, name, description, icon, schema_version, settings, public_read
       FROM collections
      WHERE slug = $1`,
    [slug]
  );
  if (!collection) return null;

  const fields = await queryMany(
    `SELECT id, key, label, type, required, default_value, options, validation,
            help_text, sort_order
       FROM collection_fields
      WHERE collection_id = $1
      ORDER BY sort_order, key`,
    [collection.id]
  );

  return { ...collection, fields };
}

/**
 * Entries of one collection.
 *
 * Ordering is the collection's own `ordering` setting, because the two cases
 * want opposite clauses and guessing from the data would change behaviour the
 * first time someone set a date on a portfolio entry:
 *
 *   'date'   — chronological (microblog). Ties break by sort_order, which is
 *              what preserves the original file order within a single day.
 *   'manual' — curated (portfolio, links). Pinned first, then sort_order, ties
 *              broken by recency so a new entry does not sink to the bottom.
 *
 * The column list is spelled out per branch rather than built by string
 * concatenation so the ORDER BY is a literal in the source, not something
 * assembled at runtime.
 */
export async function getCollectionEntries(slug, { includeDrafts = false } = {}) {
  "use cache";
  cacheLife("max");
  // The drafts flag is part of the cache key (it is an argument, and arguments
  // are part of the key), so /studio's draft-inclusive read and the reader's
  // published-only read do not share an entry.
  cacheTag(`collection:${slug}`, "collections");

  const collection = await queryOne(
    `SELECT id, ordering FROM collections WHERE slug = $1`,
    [slug]
  );
  if (!collection) return [];

  const order =
    collection.ordering === "date"
      ? `e.published_at DESC NULLS LAST, e.sort_order ASC, e.created_at DESC`
      : `e.sort_pinned DESC, e.sort_order ASC, e.published_at DESC NULLS LAST, e.created_at DESC`;

  const rows = await queryMany(
    `SELECT e.id, e.anchor, e.slug, e.status, e.values, e.sort_order, e.sort_pinned,
            e.published_at, e.created_at, e.updated_at
       FROM collection_entries e
      WHERE e.collection_id = $1
        AND ($2::boolean OR e.status = 'published')
      ORDER BY ${order}`,
    [collection.id, includeDrafts]
  );

  return rows.map((row) => ({
    id: row.anchor ?? row.id,
    slug: row.slug,
    status: row.status,
    values: row.values ?? {},
    pinned: row.sort_pinned,
    sortOrder: row.sort_order,
    publishedAt: row.published_at ? new Date(row.published_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }));
}

/**
 * The microblog, in the shape `MicroblogCard` already renders.
 *
 * The YAML had `{date, content, images}`; the normalizer in
 * src/lib/microblog.js turned that into `{id, date, paragraphs[], images[]}`,
 * splitting `content` on blank lines. That normalization is kept here, reading
 * from `values`, so the card, the page and the RSS feed do not change at all.
 *
 * `id` comes from the stored anchor, which was backfilled to the exact value
 * the live site serves today (`mb-<yyyymmdd>-<n>`, where n was the entry's
 * index in the old YAML). Those are page anchors and RSS guids: a changed id
 * re-notifies every subscriber, so the fallback for an anchorless row is
 * derived from its date rather than from its position in the result set.
 */
export async function getMicroblog() {
  const entries = await getCollectionEntries("microblog");

  return entries.map((entry) => {
    const v = entry.values;
    const paragraphs = String(v.content ?? "")
      .split(/\n{2,}/)
      .map((p) => p.replace(/\n/g, " ").trim())
      .filter(Boolean);

    const images = (Array.isArray(v.images) ? v.images : []).map((img) =>
      typeof img === "string"
        ? { src: img, desc: "" }
        : { src: img.src, desc: img.desc || "" }
    );

    // The microblog's date is a field, not a publication timestamp: entries
    // are dated by the day they were written, and the YAML carried an explicit
    // `date` on every one. `published_at` is only the tie-breaker the ordering
    // uses, so falling back to it keeps an entry without a date renderable
    // rather than blank.
    const date = v.date ?? entry.publishedAt ?? entry.createdAt;

    return {
      id: entry.id,
      date,
      paragraphs,
      images,
    };
  });
}

/** Friend links, in the shape the /links page renders. */
export async function getLinks() {
  const entries = await getCollectionEntries("links");
  return entries.map((entry) => ({
    id: entry.id,
    name: entry.values.name ?? "",
    description: entry.values.description ?? "",
    blog_url: entry.values.blog_url ?? entry.values.url ?? "",
    avatar: entry.values.avatar ?? "",
  }));
}

/**
 * The home sidebar's "terminal" quotes: the newest microblog entries, trimmed
 * to a one-liner each.
 *
 * Reads the raw `content` rather than the paragraph array, and deliberately
 * does NOT collapse blank lines into spaces the way the microblog card does.
 * The sidebar truncates at 64 characters, so any difference in how the first
 * 64 characters are assembled changes what the home page shows. This matches
 * the previous implementation byte for byte, newlines and all.
 *
 * The old version also read data/microblog.yaml from the home page directly
 * and re-implemented the sort that src/lib/microblog.js already did — two
 * parsers for one file.
 */
export async function getMicroblogQuotes({ limit = 8, minLength = 8, maxLength = 64 } = {}) {
  const entries = await getCollectionEntries("microblog");

  return entries
    .map((entry) => String(entry.values.content ?? ""))
    .filter((text) => text.length >= minLength)
    .slice(0, limit)
    .map((text) => (text.length > maxLength ? `${text.slice(0, maxLength)}…` : text));
}

/** All collections, for the /studio sidebar. */
export async function listCollections() {
  return queryMany(
    `SELECT c.id, c.slug, c.name, c.description, c.icon, c.public_read,
            (SELECT count(*)::int FROM collection_entries e
              WHERE e.collection_id = c.id) AS entry_count
       FROM collections c
      ORDER BY c.name`
  );
}
