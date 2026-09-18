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
for (const [link, live] of a) {
  const mine = b.get(link);
  if (!mine) continue;
  if (live.pub !== mine.pub) {
    pubDiff++;
    if (pubDiff <= 6) console.log(`  pubDate ${link}\n     live  ${live.pub}\n     local ${mine.pub}`);
  }
  // Allow a small delta: the feed pipeline strips KaTeX/MathML presentation,
  // and the exact byte count is not the point — a large gap would be.
  if (Math.abs(live.len - mine.len) > 200) {
    lenDiff++;
    if (lenDiff <= 6) console.log(`  content ${link}  live=${live.len} local=${mine.len}`);
  }
}

const liveBuild = (liveXml.match(/<lastBuildDate>([^<]*)</) || [])[1];
const localBuild = (localXml.match(/<lastBuildDate>([^<]*)</) || [])[1];
console.log(`\nlastBuildDate:\n  live  ${liveBuild}\n  local ${localBuild}`);

console.log(
  `\npubDate mismatches: ${pubDiff}   content-size mismatches: ${lenDiff}   missing: ${missing.length}   extra: ${extra.length}`
);
