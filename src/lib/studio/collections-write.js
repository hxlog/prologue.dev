/**
 * Collection writes: the schema, the entries, and the indexed projection.
 *
 * A collection is a user-defined content type — microblog, links, and whatever
 * the author invents next — with fields defined in /studio rather than in YAML.
 * Field values live in `collection_entries.values` as JSONB keyed by
 * `collection_fields.key`.
 *
 * ## The projection is the part that is easy to forget
 *
 * `collection_field_index` is NOT maintained by a trigger, and that is a
 * deliberate decision recorded in 0002: indexing a value needs to know its
 * TYPE, and a relation field needs a join while a markdown field needs the
 * renderer, neither of which a trigger can do. So every write here that changes
 * an entry's values rewrites its projection rows in the SAME transaction.
 *
 * Missing that is invisible until someone sorts by a custom field and gets
 * results ordered by JSONB's length-first rule, which is the bug the table
 * exists to prevent. `indexEntry` is therefore called from exactly two places
 * and both of them are inside a transaction that also writes the entry.
 *
 * ## Why anchors are not slugs
 *
 * A microblog entry is addressed as `/microblog#mb-20260905-24`, and that same
 * string is its RSS guid. It was backfilled to exactly what the live site
 * served, and the import that did it is gone — the anchors now exist only in
 * `collection_entries`, with `db/migrations/0012_seed_collections.sql` as the
 * record a fresh database is built from. So a *new* entry must not reuse or
 * shift an existing one: a changed guid re-notifies every subscriber.
 * `nextAnchor` therefore derives from the date and the highest existing suffix
 * for that date, never from a count of rows.
 */

import { pool } from "../db";
import { contentDateISO } from "../content/dates";

/** Every field type the studio can render a control for. */
export const FIELD_TYPES = [
  { key: "text", label: "短文本" },
  { key: "long_text", label: "长文本" },
  { key: "number", label: "数字" },
  { key: "date", label: "日期" },
  { key: "url", label: "网址" },
  { key: "image", label: "图片" },
  { key: "image_gallery", label: "图片组" },
  { key: "boolean", label: "开关" },
  { key: "select", label: "单选" },
];

const TYPE_KEYS = new Set(FIELD_TYPES.map((t) => t.key));

/* ─────────────────────────────── reads ──────────────────────────────────── */

export async function listCollections() {
  const { rows } = await pool.query(
    `SELECT c.id, c.slug, c.name, c.description, c.icon, c.ordering,
            c.public_read, c.updated_at,
            (SELECT count(*)::int FROM collection_entries e
              WHERE e.collection_id = c.id) AS entry_count,
            (SELECT count(*)::int FROM collection_entries e
              WHERE e.collection_id = c.id AND e.status = 'published') AS published_count,
            (SELECT count(*)::int FROM collection_fields f
              WHERE f.collection_id = c.id) AS field_count
       FROM collections c
      ORDER BY c.name`
  );
  return rows;
}

export async function getCollectionForEdit(slug) {
  const { rows } = await pool.query(
    `SELECT id, slug, name, description, icon, ordering, public_read
       FROM collections WHERE slug = $1`,
    [String(slug).toLowerCase()]
  );
  if (!rows.length) return null;

  const { rows: fields } = await pool.query(
    `SELECT id, key, label, type, required, default_value, options, help_text, sort_order
       FROM collection_fields
      WHERE collection_id = $1
      ORDER BY sort_order, key`,
    [rows[0].id]
  );

  return { ...rows[0], fields };
}

/** Entries, drafts included, in the collection's own order. */
export async function listEntries(collectionId, { limit = 500 } = {}) {
  const { rows: meta } = await pool.query(
    `SELECT ordering FROM collections WHERE id = $1`,
    [collectionId]
  );
  const order =
    meta[0]?.ordering === "date"
      ? `e.published_at DESC NULLS LAST, e.sort_order ASC, e.created_at DESC`
      : `e.sort_pinned DESC, e.sort_order ASC, e.published_at DESC NULLS LAST, e.created_at DESC`;

  const { rows } = await pool.query(
    `SELECT e.id, e.anchor, e.slug, e.status, e.values, e.sort_order, e.sort_pinned,
            e.published_at, e.created_at, e.updated_at
       FROM collection_entries e
      WHERE e.collection_id = $1
      ORDER BY ${order}
      LIMIT $2`,
    [collectionId, limit]
  );
  return rows;
}

export async function getEntry(entryId) {
  const { rows } = await pool.query(
    `SELECT e.id, e.collection_id, e.anchor, e.slug, e.status, e.values,
            e.sort_order, e.sort_pinned, e.published_at,
            c.slug AS collection_slug, c.ordering
       FROM collection_entries e
       JOIN collections c ON c.id = e.collection_id
      WHERE e.id = $1`,
    [entryId]
  );
  return rows[0] ?? null;
}

/* ─────────────────────────────── schema ─────────────────────────────────── */

/**
 * Create or update a field definition.
 *
 * Renaming a field's KEY is refused once entries exist. The key is what
 * `values` is keyed by, so renaming it orphans every value already stored under
 * the old one — the entries would silently lose that field. The label is free
 * to change at any time, because nothing is stored against it.
 */
export async function saveField(collectionId, input, { fieldId = null } = {}) {
  const key = normaliseKey(input.key);
  if (!key) return { ok: false, reason: "invalid_key" };
  if (!TYPE_KEYS.has(input.type)) return { ok: false, reason: "invalid_type" };

  const label = String(input.label ?? "").trim() || key;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    if (fieldId) {
      const { rows: current } = await client.query(
        `SELECT key FROM collection_fields WHERE id = $1 AND collection_id = $2`,
        [fieldId, collectionId]
      );
      if (!current.length) {
        await client.query("ROLLBACK");
        return { ok: false, reason: "not_found" };
      }

      if (current[0].key !== key) {
        const { rows: used } = await client.query(
          `SELECT 1 FROM collection_entries
            WHERE collection_id = $1 AND values ? $2 LIMIT 1`,
          [collectionId, current[0].key]
        );
        if (used.length) {
          await client.query("ROLLBACK");
          return { ok: false, reason: "key_in_use", key: current[0].key };
        }
      }

      await client.query(
        `UPDATE collection_fields
            SET key = $2, label = $3, type = $4, required = $5,
                default_value = $6, options = $7, help_text = $8
          WHERE id = $1`,
        [
          fieldId,
          key,
          label,
          input.type,
          input.required === true,
          JSON.stringify(input.defaultValue ?? null),
          JSON.stringify(input.options ?? {}),
          input.helpText ? String(input.helpText) : null,
        ]
      );
    } else {
      const { rows: n } = await client.query(
        `SELECT coalesce(max(sort_order) + 1, 0) AS n
           FROM collection_fields WHERE collection_id = $1`,
        [collectionId]
      );

      await client.query(
        `INSERT INTO collection_fields
           (collection_id, key, label, type, required, default_value, options,
            help_text, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (collection_id, key) DO UPDATE
           SET label = EXCLUDED.label,
               type  = EXCLUDED.type,
               required = EXCLUDED.required,
               default_value = EXCLUDED.default_value,
               options = EXCLUDED.options,
               help_text = EXCLUDED.help_text`,
        [
          collectionId,
          key,
          label,
          input.type,
          input.required === true,
          JSON.stringify(input.defaultValue ?? null),
          JSON.stringify(input.options ?? {}),
          input.helpText ? String(input.helpText) : null,
          n[0].n,
        ]
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  // The schema tag, NOT the entry tag: adding a field must rebuild the editor's
  // form but must not evict the public page, which renders entries and does not
  // know the field exists.
  return { ok: true, key };
}

/**
 * Delete a field.
 *
 * The stored values stay. Deleting a field is a decision about the FORM, and
 * silently stripping the key out of every entry's JSONB would make it
 * unrecoverable — the author who removes a field by mistake could put it back
 * and find every value gone. The projection rows do go, because they are a
 * derived index and a row for a field that no longer exists is unreachable
 * garbage. Recreating the field rebuilds them from `values`.
 */
export async function deleteField(collectionId, fieldId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `DELETE FROM collection_fields
        WHERE id = $1 AND collection_id = $2
        RETURNING key`,
      [fieldId, collectionId]
    );
    await client.query(
      `DELETE FROM collection_field_index WHERE collection_id = $1 AND field_id = $2`,
      [collectionId, fieldId]
    );
    await client.query("COMMIT");
    return { ok: rows.length === 1, key: rows[0]?.key ?? null };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/* ─────────────────────────────── entries ────────────────────────────────── */

/**
 * Create an entry.
 *
 * `sort_order` goes at the end for a manual collection and is irrelevant for a
 * dated one, where the date field drives the order. `published_at` is set from
 * the date FIELD rather than from the clock, because for a microblog the date
 * on the entry is the date it was written and that is what the archive sorts
 * by — stamping `now()` would put an entry written last week at the top.
 */
export async function createEntry(collectionId, { values = {}, status = "published" } = {}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const collection = await loadCollection(client, collectionId);
    if (!collection) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "not_found" };
    }

    const fields = await loadFields(client, collectionId);
    const clean = coerceValues(values, fields);
    const anchor = await nextAnchor(client, collection, clean);
    const publishedAt = derivePublishedAt(collection, clean);

    const { rows: order } = await client.query(
      `SELECT coalesce(max(sort_order) + 1, 0) AS n
         FROM collection_entries WHERE collection_id = $1`,
      [collectionId]
    );

    const { rows } = await client.query(
      `INSERT INTO collection_entries
         (collection_id, anchor, status, values, sort_order, published_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, anchor`,
      [
        collectionId,
        anchor,
        status === "draft" ? "draft" : "published",
        JSON.stringify(clean),
        order[0].n,
        publishedAt,
      ]
    );

    await indexEntry(client, { collectionId, entryId: rows[0].id, fields, values: clean });

    await client.query("COMMIT");
    return { ok: true, id: rows[0].id, anchor: rows[0].anchor };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Update an entry.
 *
 * The anchor is never touched. It is the entry's identity on the public page
 * and in the RSS feed, so a value change must not move it — and a date change
 * particularly must not, because the anchor embeds the date of the day the
 * entry was written rather than the date someone later corrected it to.
 */
export async function updateEntry(entryId, { values, status }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: current } = await client.query(
      `SELECT id, collection_id, status, values FROM collection_entries WHERE id = $1`,
      [entryId]
    );
    if (!current.length) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "not_found" };
    }

    const collectionId = current[0].collection_id;
    const collection = await loadCollection(client, collectionId);
    const fields = await loadFields(client, collectionId);

    // Merged with what is stored rather than replacing it, so a partial save
    // from a form that only rendered some fields cannot delete the rest. A key
    // explicitly set to null IS removed — that is how a field is cleared.
    const merged = coerceValues({ ...current[0].values, ...values }, fields);
    const nextStatus = status === undefined ? current[0].status : status;

    await client.query(
      `UPDATE collection_entries
          SET values = $2, status = $3, published_at = $4, updated_at = now()
        WHERE id = $1`,
      [entryId, JSON.stringify(merged), nextStatus, derivePublishedAt(collection, merged)]
    );

    await indexEntry(client, { collectionId, entryId, fields, values: merged });

    await client.query("COMMIT");
    return { ok: true, id: entryId, values: merged };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function deleteEntry(entryId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `DELETE FROM collection_entries WHERE id = $1 RETURNING collection_id, anchor`,
      [entryId]
    );
    // The projection rows cascade, but the search row does not follow a
    // collection at all, so it is removed explicitly.
    if (rows.length) {
      await client.query(`DELETE FROM search_index WHERE id = $1`, [
        `entry:${rows[0].collection_id}:${entryId}`,
      ]);
    }
    await client.query("COMMIT");
    return { ok: rows.length === 1, anchor: rows[0]?.anchor ?? null };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Reorder, from a list of entry ids.
 *
 * Same shape as the navigation reorder: one statement, because a
 * one-round-trip-per-row version of an operation whose whole content is "these
 * entries are now in this order" is the kind of thing that makes an admin feel
 * slow. Touches only `sort_order`, so it does not rewrite any values and does
 * not need the projection rewritten.
 *
 * `position - 1` because `WITH ORDINALITY` counts from 1 and every other writer
 * of `sort_order` counts from 0 — `createEntry` starts at 0 and increments. The
 * two are equivalent for ordering and different for everything else, and a
 * column whose values mean "first" depending on which code path wrote them is
 * the kind of inconsistency that costs an hour two years from now.
 */
export async function reorderEntries(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return { ok: false, reason: "empty" };

  await pool.query(
    `UPDATE collection_entries AS e
        SET sort_order = ordered.position - 1, updated_at = now()
       FROM unnest($1::uuid[]) WITH ORDINALITY AS ordered(id, position)
      WHERE e.id = ordered.id`,
    [ids]
  );

  return { ok: true, count: ids.length };
}

export async function setEntryPinned(entryId, pinned) {
  const { rowCount } = await pool.query(
    `UPDATE collection_entries SET sort_pinned = $2, updated_at = now() WHERE id = $1`,
    [entryId, pinned === true]
  );
  return { ok: rowCount === 1 };
}

/* ──────────────────────────── the projection ────────────────────────────── */

/**
 * Rewrite an entry's `collection_field_index` rows.
 *
 * Delete-then-insert rather than an upsert, because a value that was cleared
 * must remove its row and an upsert cannot express that. The entry has at most
 * a handful of fields, so the cost is trivial and the correctness is total:
 * after this the index says exactly what `values` says and nothing else.
 *
 * `value_ref` is written for `image` fields — the media library's row id once
 * there is one — and left null otherwise. It is the column a relation field
 * would use, and filling it for images means an image that is deleted can be
 * found on the entries that referenced it.
 */
async function indexEntry(client, { collectionId, entryId, fields, values }) {
  await client.query(`DELETE FROM collection_field_index WHERE entry_id = $1`, [entryId]);
  if (!fields.length) return;

  const rows = [];
  for (const field of fields) {
    if (!(field.key in values)) continue;
    const value = values[field.key];
    if (value === null || value === undefined || value === "") continue;

    rows.push([
      entryId,
      collectionId,
      field.id,
      field.key,
      typeof value === "string" ? value : JSON.stringify(value),
      field.type === "number" ? Number(value) : null,
      field.type === "date" ? contentDateISO(value) : null,
      field.type === "boolean" ? value === true : null,
      field.type === "image" ? stringOrNull(value?.id ?? value?.ref) : null,
    ]);
  }

  if (!rows.length) return;

  // One multi-row INSERT rather than a statement per field: the parameter count
  // is bounded by the number of fields, which is small and known.
  const values_sql = rows
    .map(
      (_, i) =>
        `($${i * 9 + 1},$${i * 9 + 2},$${i * 9 + 3},$${i * 9 + 4},$${i * 9 + 5},` +
        `$${i * 9 + 6},$${i * 9 + 7},$${i * 9 + 8},$${i * 9 + 9})`
    )
    .join(",");

  await client.query(
    `INSERT INTO collection_field_index
       (entry_id, collection_id, field_id, field_key,
        value_text, value_num, value_date, value_bool, value_ref)
     VALUES ${values_sql}
     ON CONFLICT (entry_id, field_id) DO UPDATE SET
       value_text = EXCLUDED.value_text,
       value_num  = EXCLUDED.value_num,
       value_date = EXCLUDED.value_date,
       value_bool = EXCLUDED.value_bool,
       value_ref  = EXCLUDED.value_ref`,
    rows.flat()
  );
}

/* ────────────────────────────── helpers ─────────────────────────────────── */

async function loadCollection(client, collectionId) {
  const { rows } = await client.query(
    `SELECT id, slug, ordering FROM collections WHERE id = $1`,
    [collectionId]
  );
  return rows[0] ?? null;
}

async function loadFields(client, collectionId) {
  const { rows } = await client.query(
    `SELECT id, key, type, required, default_value FROM collection_fields
      WHERE collection_id = $1 ORDER BY sort_order, key`,
    [collectionId]
  );
  return rows;
}

/**
 * Turn form input into stored values.
 *
 * Two jobs. Empty strings become null for every type, because a text input the
 * author cleared must clear the value rather than store `""` — `""` is truthy
 * in enough places downstream that it would render as an empty paragraph
 * instead of nothing. And the shape is fixed per type: a gallery is an array of
 * `{src, desc}` whether the input was strings or objects, and a boolean is a
 * boolean whether the input was `"on"` or `true`.
 */
function coerceValues(input, fields) {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const out = {};

  for (const [key, raw] of Object.entries(input ?? {})) {
    const field = byKey.get(key);

    // An unknown key is dropped rather than stored. `values` is JSONB and would
    // happily hold a stale key forever; dropping it means removing a field from
    // the schema actually stops it being written.
    if (!field) continue;

    if (raw === null || raw === undefined) {
      out[key] = null;
      continue;
    }

    switch (field.type) {
      case "boolean":
        out[key] = raw === true || raw === "true" || raw === "on";
        break;

      case "number": {
        const n = Number(raw);
        out[key] = raw === "" || Number.isNaN(n) ? null : n;
        break;
      }

      case "date": {
        const iso = contentDateISO(raw);
        out[key] = raw === "" ? null : (iso ?? String(raw));
        break;
      }

      case "image_gallery":
        out[key] = toGallery(raw);
        break;

      case "image": {
        const value = toImage(raw);
        out[key] = value;
        break;
      }

      default: {
        const text = String(raw);
        out[key] = text === "" ? null : text;
      }
    }
  }

  return out;
}

/** A gallery is always `[{src, desc}]`, whatever the caller passed. */
function toGallery(raw) {
  const list = Array.isArray(raw) ? raw : String(raw ?? "").split(/\s*\n\s*/);
  return list
    .map((item) =>
      typeof item === "string" ? { src: item.trim(), desc: "" } : {
        src: String(item?.src ?? "").trim(),
        desc: String(item?.desc ?? ""),
      }
    )
    .filter((item) => item.src);
}

/** An image is either a stored path string or `{src, id, alt}`. */
function toImage(raw) {
  if (typeof raw === "string") {
    const src = raw.trim();
    return src === "" ? null : { src, alt: "" };
  }
  const src = String(raw?.src ?? "").trim();
  if (!src) return null;
  return { src, alt: String(raw?.alt ?? ""), id: raw?.id ?? null };
}

/**
 * The `published_at` a dated collection sorts by.
 *
 * Read from the date FIELD, not the clock. For a microblog the date on the
 * entry is the day it was written, and the archive orders by when things were
 * written rather than when they were typed into the database — an entry
 * backfilled from a notebook must sort where it belongs, not at the top.
 */
function derivePublishedAt(collection, values) {
  if (collection?.ordering !== "date") return null;
  const dateValue = values.date ?? values.published_at ?? null;
  return contentDateISO(dateValue);
}

/**
 * The next anchor for a new entry.
 *
 * `mb-<yyyymmdd>-<n>`, matching what the live site serves, with `n` derived
 * from the highest EXISTING suffix for that date plus one — never from a count
 * of rows. The two differ as soon as anything is deleted, and a collision would
 * break the unique index while reusing a retired anchor would collide with a
 * guid already in subscribers' feeds.
 *
 * The collection's slug is the prefix, so a future collection gets its own
 * namespace without this function knowing anything about it.
 */
async function nextAnchor(client, collection, values) {
  const dateKey = String(values.date ?? "").slice(0, 10).replace(/-/g, "");
  const prefix = `${anchorPrefix(collection.slug)}-${dateKey || "undated"}-`;

  const { rows } = await client.query(
    `SELECT anchor FROM collection_entries
      WHERE collection_id = $1 AND anchor LIKE $2`,
    [collection.id, `${prefix}%`]
  );

  let highest = -1;
  for (const row of rows) {
    const n = Number(String(row.anchor).slice(prefix.length));
    if (Number.isInteger(n) && n > highest) highest = n;
  }

  if (!rows.length) {
    // No entries for this date yet. Start at 0 rather than at the global row
    // count: the original YAML numbering was global, but reproducing that for
    // new entries would mean an anchor whose suffix jumps every time an entry
    // on another date is added, which is noise in a URL people can see.
    return `${prefix}0`;
  }
  return `${prefix}${highest + 1}`;
}

function anchorPrefix(slug) {
  return slug === "microblog" ? "mb" : String(slug).slice(0, 2).toLowerCase();
}

function normaliseKey(value) {
  const key = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return /^[a-z_]/.test(key) ? key : "";
}

function stringOrNull(value) {
  return value === null || value === undefined || value === "" ? null : String(value);
}
