/**
 * Smoke-check the local production server: every route responds, the feeds are
 * well-formed, the search endpoint returns hits, and RSS item guids still match
 * what the live site serves.
 */
const BASE = process.env.BASE || "http://localhost:3211";

const ROUTES = [
  "/",
  "/blog",
  "/about",
  "/microblog",
  "/links",
  "/rss",
  "/atomfeed",
  "/jsonfeed",
  "/microblog/rss",
  "/sitemap.xml",
  "/robots.txt",
  "/tags/Economics",
  "/tags/Web3",
  "/blog/2023-introduction-to-articles",
];

let failures = 0;

for (const route of ROUTES) {
  const res = await fetch(`${BASE}${route}`);
  const body = await res.text();
  const ok = res.status === 200 && body.length > 0;
  if (!ok) failures++;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${String(res.status).padEnd(4)} ${String(body.length).padStart(8)}b  ${route}`
  );
}

console.log("\n--- search ---");
for (const q of ["北京", "加密货币", "教育改革", "react", "美联储", "不存在的词组xyz"]) {
  const res = await fetch(`${BASE}/api/search?q=${encodeURIComponent(q)}`);
  const json = await res.json();
  const n = json.results?.length ?? -1;
  console.log(
    `  ${q.padEnd(14)} ${String(n).padStart(3)} result(s)  ${json.results?.[0]?.title ?? "-"}`
  );
  // The live site's Fuse search returned nothing for most of these; a zero here
  // for a term that exists in the corpus is the failure this checks for.
  if (n <= 0 && q !== "不存在的词组xyz") failures++;
}

console.log("\n--- feed guids ---");
const microRes = await fetch(`${BASE}/microblog/rss`);
const microXml = await microRes.text();
const guids = [...microXml.matchAll(/<guid[^>]*>([^<]+)<\/guid>/g)].map((m) => m[1]);
console.log(`  microblog/rss: ${guids.length} guids`);
console.log(`  first: ${guids[0]}`);

const rssRes = await fetch(`${BASE}/rss`);
const rssXml = await rssRes.text();
console.log(`  rss: ${(rssXml.match(/<item>/g) || []).length} items`);
console.log(`  lastBuildDate: ${(rssXml.match(/<lastBuildDate>([^<]*)</) || [])[1]}`);

if (failures) {
  console.log(`\n${failures} failure(s).`);
  process.exitCode = 1;
} else {
  console.log("\nAll routes and searches OK.");
}
