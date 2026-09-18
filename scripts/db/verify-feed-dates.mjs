#!/usr/bin/env node
/**
 * Verify the database's post dates against the LIVE site's RSS feed.
 *
 *   node --env-file=.env.local scripts/db/verify-feed-dates.mjs
 *
 * This is the only parity check that compares against production rather than
 * against the local Contentlayer output, and it is the one that catches the
 * class of bug that motivated it: the local build and the deployed build
 * disagree about a date because the two ran in different time zones.
 *
 * Concretely, `new Date("2025-2-15")` — an unpadded month, so not ISO 8601 —
 * is parsed in LOCAL time, and the rendered date is formatted in local time
 * too. The value therefore round-trips correctly on whichever machine produced
 * it and is simply a different day on any machine in another zone:
 *
 *   local (.contentlayer)  2025-02-14T16:00Z  ->  renders 2025年2月14日
 *   live (Vercel, UTC)     2025-02-15T00:00Z  ->  renders 2025年2月15日
 *
 * The live rendering is the correct one — it is what the author typed and what
 * readers have been seeing — so this script treats the feed as the source of
 * truth and fails if the database disagrees.
 */

import process from "node:process";
import pg from "pg";

const FEED_URL = process.env.FEED_URL || "https://prologue.dev/rss";

function loadConnectionString() {
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) {
    console.error("Set DATABASE_URL_UNPOOLED (or DATABASE_URL).");
    process.exit(1);
  }
  return url;
}

async function fetchFeedItems() {
  const res = await fetch(FEED_URL);
  if (!res.ok) throw new Error(`${FEED_URL} returned ${res.status}`);
  const xml = await res.text();

  const items = new Map();
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const body = m[1];
    const link = (body.match(/<link>([^<]*)<\/link>/) || [])[1];
    const pub = (body.match(/<pubDate>([^<]*)<\/pubDate>/) || [])[1];
    if (!link || !pub) continue;
    const slug = link.replace(/^https?:\/\/[^/]+\/blog\//, "");
    items.set(slug, new Date(pub).toISOString());
  }
  return items;
}

const live = await fetchFeedItems();
console.log(`live feed: ${live.size} items with a pubDate`);

const client = new pg.Client({ connectionString: loadConnectionString() });
await client.connect();
const { rows } = await client.query(
  `SELECT slug, published_at, lastmod
     FROM posts
    WHERE status = 'published'
    ORDER BY slug`
);
await client.end();

const iso = (d) => (d ? new Date(d).toISOString() : null);
const mismatches = [];
let compared = 0;

for (const r of rows) {
  const target = live.get(r.slug);
  if (!target) continue;
  compared++;

  // The feed item's primary date is publishDate with lastmod as `updated`;
  // the serializer picks one. Accept either, but require at least one to
  // match exactly — a near miss is still a wrong date on the page.
  const pub = iso(r.published_at);
  const lm = iso(r.lastmod);
  if (pub !== target && lm !== target) {
    mismatches.push({ slug: r.slug, live: target, pub, lastmod: lm });
  }
}

console.log(`compared ${compared} published posts\n`);

for (const m of mismatches) {
  console.log(`  ✗ ${m.slug}`);
  console.log(`      live      ${m.live}`);
  console.log(`      published ${m.pub}`);
  console.log(`      lastmod   ${m.lastmod}`);
}

const missing = [...live.keys()].filter((s) => !rows.some((r) => r.slug === s));
if (missing.length) {
  console.log(`\n${missing.length} feed item(s) with no published row:`);
  for (const s of missing.slice(0, 10)) console.log(`  · ${s}`);
}

if (mismatches.length === 0 && missing.length === 0) {
  console.log("All dates match the live feed.");
} else {
  console.log(
    `\n${mismatches.length} date mismatch(es), ${missing.length} missing row(s).`
  );
  process.exitCode = 1;
}
