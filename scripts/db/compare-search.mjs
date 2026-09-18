/**
 * Search quality comparison: Fuse.js (current client-side scheme) vs
 * PostgreSQL zh_tok() full-text search over post BODIES.
 *
 * Fuse currently indexes only title + description + tags (NOT body), so the
 * comparison answers: what does moving body text into the search surface buy,
 * and where does each scheme win?
 *
 * Usage (from the worktree root):
 *   node --env-file=.env.local .tmp/search-compare.mjs
 */
import fs from "node:fs";
import pg from "pg";
import Fuse from "fuse.js";

const REPO = "D:/prologue.dev";

const TAG_LABELS = {
  Economics: "经济学", Finance: "金融", Quant: "数据科学", Crypto: "加密货币",
  AI: "人工智能", Sociology: "社会学", Capitalism: "资本主义", Education: "教育",
  Inequality: "不平等", Politics: "政治", Philosophy: "哲学", Technology: "技术",
  Meta: "随笔", Translations: "翻译", Gender: "性别",
};

// ---------------------------------------------------------------- Fuse setup
// Exactly the current production options from src/lib/use-post-search.js
const index = JSON.parse(fs.readFileSync(`${REPO}/public/search-index.json`, "utf8"));
const fuse = new Fuse(index, {
  keys: [
    { name: "title", weight: 1 },
    { name: "text", weight: 0.8 },
    { name: "description", weight: 0.6 },
    { name: "tags", weight: 0.5 },
  ],
  ignoreLocation: true,
  minMatchCharLength: 2,
  threshold: 0.3,
  shouldSort: true,
});

const client = new pg.Client({ connectionString: process.env.DATABASE_URL_UNPOOLED });
await client.connect();

const QUERIES = [
  "加密货币",
  "教育改革",
  "通货膨胀",
  "文凭社会",
  "比特币",
  "社会主义",
  "量化宽松",
  "美联储",
  "transformer",
  "shiki",
  "PostgreSQL",
  "React 服务端渲染",
  "Michael Jordan",       // likely absent — typo/noise test
  "加密货币 投资",          // multi-term
  "教育",
];

console.log("");
console.log("=".repeat(96));
console.log("  Fuse.js (title+desc+tags, client) vs PostgreSQL zh_tok (title+desc+BODY, server)");
console.log("=".repeat(96));

const summary = { fuseOnly: [], pgOnly: [], both: [], neither: [] };

for (const q of QUERIES) {
  const fuseHits = fuse.search(q).slice(0, 5).map((r) => r.item.slug.replace(/^\//, "").replace(/^blog\//, ""));

  const { rows } = await client.query(
    `SELECT id, title
       FROM search_index
      WHERE search_doc @@ zh_q($1)
      ORDER BY ts_rank_cd(search_doc, zh_q($1)) DESC
      LIMIT 5`,
    [q]
  );
  const pgHits = rows.map((r) => r.id.replace(/^post:/, ""));

  const fs = new Set(fuseHits);
  const ps = new Set(pgHits);
  const both = [...fs].filter((x) => ps.has(x));
  const onlyF = [...fs].filter((x) => !ps.has(x));
  const onlyP = [...ps].filter((x) => !fs.has(x));

  if (!fuseHits.length && !pgHits.length) summary.neither.push(q);
  else if (onlyP.length && !onlyF.length) summary.pgOnly.push(q);
  else if (onlyF.length && !onlyP.length) summary.fuseOnly.push(q);
  else summary.both.push(q);

  console.log("");
  console.log(`QUERY  ${JSON.stringify(q)}`);
  console.log(`  fuse (${fuseHits.length}): ${fuseHits.length ? fuseHits.join(", ") : "-"}`);
  console.log(`  pg   (${pgHits.length}): ${pgHits.length ? pgHits.join(", ") : "-"}`);
  if (onlyP.length) console.log(`  >> only PostgreSQL found: ${onlyP.join(", ")}`);
  if (onlyF.length) console.log(`  >> only Fuse found:       ${onlyF.join(", ")}`);
  if (both.length) console.log(`  == both: ${both.length}`);
}

console.log("");
console.log("-".repeat(96));
console.log(`  Queries where ONLY PostgreSQL returned results: ${summary.pgOnly.length}`);
for (const q of summary.pgOnly) console.log(`     ${JSON.stringify(q)}`);
console.log(`  Queries where ONLY Fuse returned results:       ${summary.fuseOnly.length}`);
for (const q of summary.fuseOnly) console.log(`     ${JSON.stringify(q)}`);
console.log(`  Queries with no results from either:            ${summary.neither.length}`);
for (const q of summary.neither) console.log(`     ${JSON.stringify(q)}`);
console.log("-".repeat(96));

// --------------------------------------------- what body search unlocks
console.log("");
console.log("BODY-ONLY HITS: terms that appear in post bodies but NOT in any title/description/tags");
const probes = ["冯诺依曼", "风险平价", "布雷顿森林", "量化宽松", "M1", "影子银行", "代谢", "厌恶损失"];
for (const p of probes) {
  const fuseN = fuse.search(p).length;
  const { rows } = await client.query(
    `SELECT count(*)::int n FROM search_index WHERE search_doc @@ zh_q($1)`,
    [p]
  );
  console.log(`  ${p.padEnd(14)} fuse=${String(fuseN).padStart(3)}   postgres=${String(rows[0].n).padStart(3)}`);
}

await client.end();
