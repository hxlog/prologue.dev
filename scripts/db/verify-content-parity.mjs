#!/usr/bin/env node
/**
 * Data-layer parity check: every field the public site reads from a Contentlayer
 * document must be reproducible from the database.
 *
 * This complements verify-renderer-parity.mjs, which checks that renderMarkdown()
 * produces byte-identical HTML. This one checks the surrounding metadata —
 * slugs (URLs must not change), dates, tags, reading time — is imported without
 * drift.
 *
 *   CONTENTLAYER_ROOT=/path/to/checkout node scripts/db/verify-content-parity.mjs
 *
 * CONTENTLAYER_ROOT is needed because the build output lives in the checkout
 * that ran contentlayer2; a fresh worktree has no .contentlayer/.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import pg from "pg";

const CONTENTLAYER_ROOT = process.env.CONTENTLAYER_ROOT || process.cwd();
const POSTS_JSON = path.join(
  CONTENTLAYER_ROOT,
  ".contentlayer/generated/Post/_index.json"
);

const { parseContentDate } = await import(
  pathToFileURL(path.join(process.cwd(), "src/lib/content/dates.js")).href
);

function loadConnectionString() {
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) {
    console.error("Set DATABASE_URL_UNPOOLED (or DATABASE_URL).");
    process.exit(1);
  }
  return url;
}

/**
 * Dates are compared against the raw frontmatter, not against Contentlayer's
 * parsed Date.
 *
 * Contentlayer's instant depends on the build machine's time zone — locally
 * `2025-2-15` becomes 2025-02-14T16:00Z, on Vercel it becomes
 * 2025-02-15T00:00Z — so comparing against it would assert the local machine's
 * bug rather than the author's intent. The raw string is unambiguous, and the
 * live feed (checked separately by verify-feed-dates.mjs) confirms which
 * interpretation production actually renders.
 */
function rawFrontmatterDate(sourceFilePath, field) {
  const src = readFileSync(
    path.join(process.cwd(), "data/content", sourceFilePath),
    "utf8"
  );
  const block = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---/.exec(src);
  if (!block) return null;
  const m = new RegExp(`^${field}:\\s*(.+?)\\s*$`, "m").exec(block[1]);
  return m ? m[1] : null;
}

/** Same instant? Compares by time, tolerating the string/timestamp shape gap. */
function sameInstant(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  if (Number.isNaN(ta) || Number.isNaN(tb)) return String(a) === String(b);
  return ta === tb;
}

function sameJson(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * `headings` is stored in a jsonb column, and jsonb does not preserve key
 * order — it sorts keys by length then bytewise. Comparing serialised forms
 * would therefore report a mismatch on 63/63 rows that is purely a storage
 * artefact. Compare element-wise on the three meaningful keys instead.
 */
function sameHeadings(a, b) {
  const list = (v) => (Array.isArray(v) ? v : []);
  const [x, y] = [list(a), list(b)];
  if (x.length !== y.length) return false;
  return x.every((h, i) => {
    const g = y[i] ?? {};
    return h.level === g.level && h.text === g.text && h.id === g.id;
  });
}

/** Element-wise, order-sensitive comparison. `Object.is` on arrays is always
 *  false — two equal arrays are still two different objects. */
function sameArray(a, b) {
  const x = Array.isArray(a) ? a : [];
  const y = Array.isArray(b) ? b : [];
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

async function main() {
  const contentlayer = JSON.parse(readFileSync(POSTS_JSON, "utf8"));
  const bySlug = new Map(contentlayer.map((p) => [p.slugAsParams, p]));

  const client = new pg.Client({
    connectionString: loadConnectionString(),
    application_name: "prologue-parity",
  });
  await client.connect();

  const { rows: dbPosts } = await client.query(`
    SELECT
      p.slug,
      p.status,
      p.featured,
      p.cover_image,
      p.cover_image_desc,
      p.published_at,
      p.lastmod,
      p.categories,
      r.title,
      r.description,
      r.headings,
      r.reading_time,
      r.html,
      coalesce(
        (SELECT array_agg(t.slug ORDER BY pt.position)
           FROM post_tags pt JOIN tags t ON t.id = pt.tag_id
          WHERE pt.post_id = p.id),
        '{}'
      ) AS tag_slugs
    FROM posts p
    JOIN post_revisions r
      ON r.id = coalesce(p.published_revision_id, p.draft_revision_id)
    ORDER BY p.slug
  `);

  await client.end();

  const failures = [];
  const seen = new Set();

  for (const row of dbPosts) {
    const slug = row.slug;
    seen.add(slug);
    const cl = bySlug.get(slug);
    if (!cl) {
      failures.push(`[${slug}] present in database but not in Contentlayer output`);
      continue;
    }

    const check = (field, a, b, cmp = Object.is) => {
      if (!cmp(a, b)) {
        failures.push(
          `[${slug}] ${field}\n      contentlayer: ${JSON.stringify(a)}\n      database:     ${JSON.stringify(b)}`
        );
      }
    };

    check("title", cl.title, row.title);
    check("description", cl.description ?? null, row.description ?? null);

    // The route-visible fields. A mismatch here is a URL change, which the
    // brief forbids outright.
    check("slug (route)", cl.slug, `/blog/${slug}`);
    check("slugAsParams", cl.slugAsParams, slug);

    // Compare via parseContentDate so the raw frontmatter string is read the
    // same way the importer read it, rather than by the host's Date parser.
    const rawPub = rawFrontmatterDate(cl._raw.sourceFilePath, "publishDate");
    const rawMod = rawFrontmatterDate(cl._raw.sourceFilePath, "lastmod");
    check(
      "publishDate",
      parseContentDate(rawPub)?.toISOString() ?? null,
      row.published_at?.toISOString() ?? null
    );
    check(
      "lastmod",
      parseContentDate(rawMod)?.toISOString() ?? null,
      row.lastmod?.toISOString() ?? null
    );

    check("draft", cl.draft === true, row.status !== "published");
    check("featured", cl.featured === true, row.featured === true);

    check("image", (cl.image ?? "") || "", row.cover_image ?? "");
    check("imageDesc", (cl.imageDesc ?? "") || "", row.cover_image_desc ?? "");

    // Order matters: the chip row shows the first 2-3 tags and collapses the
    // rest, so the frontmatter array order is what a reader sees.
    check("tags (order + set)", cl.tags ?? [], row.tag_slugs ?? [], sameArray);

    check("readingTime.words", cl.readingTime?.words, row.reading_time?.words);
    check("readingTime.text", cl.readingTime?.text, row.reading_time?.text);
    check("readingTime.minutes", cl.readingTime?.minutes, row.reading_time?.minutes);
    check("headings", cl.headings, row.headings, sameHeadings);

    check("body.html length", cl.body?.html?.length, row.html?.length);
    if (cl.body?.html !== row.html) {
      // Locate the first divergence instead of dumping two 40 KB strings.
      let i = 0;
      const a = cl.body?.html ?? "";
      const b = row.html ?? "";
      while (i < a.length && i < b.length && a[i] === b[i]) i++;
      failures.push(
        `[${slug}] body.html differs at offset ${i}\n` +
          `      contentlayer: ${JSON.stringify(a.slice(Math.max(0, i - 40), i + 40))}\n` +
          `      database:     ${JSON.stringify(b.slice(Math.max(0, i - 40), i + 40))}`
      );
    }
  }

  for (const [slug] of bySlug) {
    if (!seen.has(slug)) {
      failures.push(`[${slug}] missing from the database`);
    }
  }

  console.log(
    `Compared ${seen.size} posts (Contentlayer) against ${dbPosts.length} rows (database).`
  );

  if (failures.length === 0) {
    console.log("All fields match.");
    return;
  }

  console.log(`\n${failures.length} mismatch(es):\n`);
  for (const f of failures) console.log(`  · ${f}`);
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
