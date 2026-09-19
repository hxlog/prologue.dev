import fs from "node:fs";
import pg from "pg";

const LIVE = "https://prologue.dev/rss";
const LOCAL = process.env.LOCAL_BASE || "http://localhost:3211";

const liveXml = await (await fetch(LIVE)).text();
const localXml = await (await fetch(`${LOCAL}/rss`)).text();

function items(xml) {
  const out = new Map();
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const body = m[1];
    const link = (body.match(/<link>([^<]*)<\/link>/) || [])[1];
    const pub = (body.match(/<pubDate>([^<]*)<\/pubDate>/) || [])[1];
    const content = (body.match(/<content:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>/) || [])[1];
    if (link) out.set(link, { pub, len: (content || "").length });
  }
  return out;
}

const a = items(liveXml);
const b = items(localXml);

console.log(`live items: ${a.size}   local items: ${b.size}`);

const missing = [...a.keys()].filter((k) => !b.has(k));
const extra = [...b.keys()].filter((k) => !a.has(k));
if (missing.length) console.log(`MISSING (${missing.length}):\n  ` + missing.slice(0, 8).join("\n  "));
if (extra.length) console.log(`EXTRA (${extra.length}):\n  ` + extra.slice(0, 8).join("\n  "));

let pubDiff = 0;
let lenDiff = 0;
let worst = 0;

/**
 * A tolerance, and the reason for it, stated rather than hidden.
 *
 * This compares against the DEPLOYED site, and the deployment renders from
 * whatever revision artifacts it was built with — which are not this branch's.
 * The stored HTML on both sides came from the same markdown, but at different
 * points in the pipeline's history, so the difference a size check sees here is
 * mostly "that build is older than this one" rather than "this change did
 * that". Measured: the largest gap today is 726 bytes, on one post, entirely
 * `class="rounded-lg mx-auto lightbox-image …"` + `loading` + `decoding` on its
 * seven images — attributes the deployed revision carries and the re-imported
 * one does not.
 *
 * Byte-exactness is therefore not the property to assert HERE. What this script
 * is for is the coarse one: every item present, no item extra, no pubDate moved,
 * and no item whose body changed by a paragraph. The fine-grained question —
 * "did this change alter the feed, and how" — is answered against the previous
 * revision of the code instead, by `scripts/studio/feed-before-after.mjs`, where
 * both sides render the same stored document.
 */
const TOLERANCE = 1200;

for (const [link, live] of a) {
  const mine = b.get(link);
  if (!mine) continue;
  if (live.pub !== mine.pub) {
    pubDiff++;
    if (pubDiff <= 6) console.log(`  pubDate ${link}\n     live  ${live.pub}\n     local ${mine.pub}`);
  }

  const delta = Math.abs(live.len - mine.len);
  worst = Math.max(worst, delta);
  if (delta > TOLERANCE) {
    lenDiff++;
    if (lenDiff <= 6) console.log(`  content ${link}  live=${live.len} local=${mine.len} (${mine.len - live.len})`);
  }
}

const liveBuild = (liveXml.match(/<lastBuildDate>([^<]*)</) || [])[1];
const localBuild = (localXml.match(/<lastBuildDate>([^<]*)</) || [])[1];
console.log(`\nlastBuildDate:\n  live  ${liveBuild}\n  local ${localBuild}`);

console.log(
  `\npubDate mismatches: ${pubDiff}   content-size mismatches: ${lenDiff}   missing: ${missing.length}   extra: ${extra.length}`
);
console.log(`largest content-size delta: ${worst} bytes (tolerance ${TOLERANCE})`);
