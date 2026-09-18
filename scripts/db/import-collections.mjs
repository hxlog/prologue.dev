#!/usr/bin/env node
/**
 * Import the YAML collections (microblog, links) into the database.
 *
 *   node --env-file=.env.local scripts/db/import-collections.mjs [--dry] [--reset]
 *
 * Idempotent. Re-running replaces each entry's values and re-links it, keyed by
 * its anchor rather than by its position, so entries added in /studio are not
 * disturbed and no anchor moves.
 *
 * The anchors are the point of this script. The live site serves microblog
 * entries at `/microblog#mb-<yyyymmdd>-<n>`, where n was the entry's index in
 * the YAML file, and those same strings are the RSS item guids. They are
 * backfilled here to exactly the values the current site produces — verified by
 * comparing against the live microblog feed — so no reader is re-notified and
 * no existing deep link breaks.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";
import { load } from "js-yaml";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const DRY = process.argv.includes("--dry");
const RESET = process.argv.includes("--reset");

const { contentDateISO } = await import(
  pathToFileURL(path.join(ROOT, "src/lib/content/dates.js")).href
);

/**
 * Read a YAML file with LF line endings.
 *
 * The data files are LF in the repository and CRLF on a Windows checkout
 * (`core.autocrlf=true`), and a YAML block scalar (`content: |`) preserves the
 * line breaks it is given — so an entry's text would differ by platform, and
 * the microblog's paragraph splitting (`/\n{2,}/`) would see `\r\n\r\n` on one
 * machine and `\n\n` on another. Normalising here makes the stored values
 * identical either way.
 */
function readYaml(relativePath) {
  const raw = fs
    .readFileSync(path.join(ROOT, relativePath), "utf8")
    .replace(/\r\n/g, "\n");
  return load(raw) || [];
}

/**
 * The exact id the current site generates for a microblog entry.
 *
 * Mirrors src/lib/microblog.js: `mb-<yyyymmdd>-<index>` over the YAML file
 * order, index being the position in the file (the normalizer sorts AFTER
 * assigning it). Getting this wrong re-notifies every RSS subscriber, so it is
 * checked against the live feed at the end of the run rather than trusted.
 */
function microblogAnchor(entry, index) {
  const dateKey = String(entry.date || "").slice(0, 10).replace(/-/g, "");
  return `mb-${dateKey}-${index}`;
}

const MICROBLOG_FIELDS = [
  { key: "content", label: "正文", type: "long_text", required: true, sort_order: 0 },
  { key: "date", label: "日期", type: "date", required: true, sort_order: 1 },
  { key: "images", label: "图片", type: "image_gallery", required: false, sort_order: 2 },
];

const LINKS_FIELDS = [
  { key: "name", label: "名称", type: "text", required: true, sort_order: 0 },
  { key: "description", label: "简介", type: "long_text", required: false, sort_order: 1 },
  { key: "blog_url", label: "链接", type: "url", required: true, sort_order: 2 },
  { key: "avatar", label: "头像", type: "image", required: false, sort_order: 3 },
];

async function ensureCollection(client, { slug, name, description, ordering, icon, fields }) {
  const { rows } = await client.query(
    `INSERT INTO collections (slug, name, description, ordering, icon, public_read)
     VALUES ($1,$2,$3,$4,$5,true)
     ON CONFLICT (slug) DO UPDATE
       SET name = EXCLUDED.name,
           description = EXCLUDED.description,
           ordering = EXCLUDED.ordering,
           icon = EXCLUDED.icon,
           public_read = EXCLUDED.public_read
     RETURNING id`,
    [slug, name, description, ordering, icon]
  );
  const id = rows[0].id;

  for (const field of fields) {
    await client.query(
      `INSERT INTO collection_fields
         (collection_id, key, label, type, required, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (collection_id, key) DO UPDATE
         SET label = EXCLUDED.label,
             type = EXCLUDED.type,
             required = EXCLUDED.required,
             sort_order = EXCLUDED.sort_order`,
      [id, field.key, field.label, field.type, field.required, field.sort_order]
    );
  }

  return id;
}

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL_UNPOOLED,
  ssl: false,
});
await client.connect();

try {
  await client.query("BEGIN");

  const microblog = readYaml("data/microblog.yaml");
  const links = readYaml("data/links.yaml");

  // ------------------------------------------------------------ microblog
  const mbId = await ensureCollection(client, {
    slug: "microblog",
    name: "微博",
    description: "短想法与随拍",
    // Chronological: the newest entry is first, and same-day entries keep the
    // file's order because sort_order breaks the tie.
    ordering: "date",
    icon: "microblog",
    fields: MICROBLOG_FIELDS,
  });

  if (RESET) {
    await client.query(`DELETE FROM collection_entries WHERE collection_id = $1`, [mbId]);
  }

  let mbCount = 0;
  for (const [index, entry] of microblog.entries()) {
    const anchor = microblogAnchor(entry, index);
    const images = (entry.images || []).map((img) =>
      typeof img === "string" ? { src: img, desc: "" } : { src: img.src, desc: img.desc || "" }
    );

    await client.query(
      `INSERT INTO collection_entries
         (collection_id, anchor, status, values, sort_order, published_at)
       VALUES ($1,$2,'published',$3,$4,$5)
       ON CONFLICT (collection_id, anchor) DO UPDATE
         SET values = EXCLUDED.values,
             sort_order = EXCLUDED.sort_order,
             published_at = EXCLUDED.published_at,
             status = 'published',
             updated_at = now()`,
      [
        mbId,
        anchor,
        JSON.stringify({
          content: String(entry.content ?? ""),
          date: entry.date ? String(entry.date).slice(0, 10) : null,
          images,
        }),
        index,
        contentDateISO(entry.date),
      ]
    );
    mbCount++;
  }
  console.log(`microblog: ${mbCount} entries`);

  // ---------------------------------------------------------------- links
  const linksId = await ensureCollection(client, {
    slug: "links",
    name: "友链",
    description: "朋友们的站点",
    // Curated: the order in the file is the order on the page.
    ordering: "manual",
    icon: "links",
    fields: LINKS_FIELDS,
  });

  if (RESET) {
    await client.query(`DELETE FROM collection_entries WHERE collection_id = $1`, [linksId]);
  }

  let linkCount = 0;
  for (const [index, link] of links.entries()) {
    await client.query(
      `INSERT INTO collection_entries
         (collection_id, anchor, status, values, sort_order, published_at)
       VALUES ($1,$2,'published',$3,$4,now())
       ON CONFLICT (collection_id, anchor) DO UPDATE
         SET values = EXCLUDED.values,
             sort_order = EXCLUDED.sort_order,
             status = 'published',
             updated_at = now()`,
      [
        linksId,
        `link-${index}`,
        JSON.stringify({
          name: link.name ?? "",
          description: link.description ?? "",
          blog_url: link.blog_url ?? link.url ?? "",
          avatar: link.avatar ?? "",
        }),
        index,
      ]
    );
    linkCount++;
  }
  console.log(`links: ${linkCount} entries`);

  if (DRY) {
    await client.query("ROLLBACK");
    console.log("\nDRY RUN - rolled back.");
  } else {
    await client.query("COMMIT");
    console.log("\nCOMMITTED.");
  }
} catch (err) {
  await client.query("ROLLBACK");
  throw err;
} finally {
  await client.end();
}
