#!/usr/bin/env node
/**
 * Dump the reader-visible projection of every post to a stable text form.
 *
 * Used to prove that swapping the importer (Contentlayer's generated index ->
 * reading data/content directly) produced identical rows. Diff two dumps.
 *
 *   node --env-file=.env.local scripts/db/dump-posts.mjs > /tmp/before.txt
 */
import { createHash } from "node:crypto";
import process from "node:process";
import pg from "pg";

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL_UNPOOLED,
  ssl: false,
});
await client.connect();

const { rows } = await client.query(`
  SELECT
    p.slug,
    p.status,
    p.featured,
    p.cover_image,
    p.cover_image_desc,
    p.source_path,
    p.giscus_enabled,
    p.published_at,
    p.lastmod,
    r.revision_number,
    r.title,
    r.description,
    r.headings,
    r.reading_time,
    r.renderer_version,
    r.content_hash,
    encode(sha256(convert_to(r.html, 'UTF8')), 'hex') AS html_sha,
    length(r.html) AS html_len,
    coalesce(
      (SELECT array_agg(t.slug ORDER BY pt.position)
         FROM post_tags pt JOIN tags t ON t.id = pt.tag_id
        WHERE pt.post_id = p.id),
      '{}'
    ) AS tags,
    (SELECT body_text FROM search_index s WHERE s.id = 'post:' || p.slug) IS NOT NULL AS indexed
  FROM posts p
  JOIN post_revisions r ON r.id = coalesce(p.published_revision_id, p.draft_revision_id)
  ORDER BY p.slug
`);

await client.end();

for (const row of rows) {
  console.log(
    [
      row.slug,
      row.status,
      row.featured,
      row.cover_image ?? "-",
      row.cover_image_desc ?? "-",
      row.source_path ?? "-",
      row.giscus_enabled,
      row.published_at?.toISOString() ?? "-",
      row.lastmod?.toISOString() ?? "-",
      row.revision_number,
      row.title,
      row.description ?? "-",
      JSON.stringify(row.headings),
      JSON.stringify(row.reading_time),
      row.renderer_version,
      row.content_hash,
      row.html_len,
      row.html_sha,
      JSON.stringify(row.tags),
      row.indexed,
    ].join(" | ")
  );
}
