/**
 * Sanity checks for the static export output (out/). Run after "yarn export".
 * Exits non-zero on the first structural regression so CI catches a broken
 * export before wrangler deploys it.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const OUT = process.env.CF_ASSETS_OUT || join(process.cwd(), "out");
const failures = [];
const ok = (cond, message) => { if (!cond) failures.push(message); };

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

ok(existsSync(join(OUT, "index.html")), "out/index.html missing");
ok(existsSync(join(OUT, "404.html")), "out/404.html missing");
ok(existsSync(join(OUT, "_headers")), "out/_headers missing");
ok(existsSync(join(OUT, "_redirects")), "out/_redirects missing");
ok(existsSync(join(OUT, "rss")), "out/rss missing");
ok(existsSync(join(OUT, "atomfeed")), "out/atomfeed missing");
ok(existsSync(join(OUT, "jsonfeed")), "out/jsonfeed missing");
ok(existsSync(join(OUT, "sitemap.xml")), "out/sitemap.xml missing");
ok(existsSync(join(OUT, "robots.txt")), "out/robots.txt missing");
ok(existsSync(join(OUT, "search-index.json")), "out/search-index.json missing");
ok(existsSync(join(OUT, "search-index-lite.json")), "out/search-index-lite.json missing");

const files = walk(OUT);
ok(files.length < 20000, "out/ has " + files.length + " files (>20,000 static-asset limit)");
const biggest = files.reduce((m, f) => Math.max(m, statSync(f).size), 0);
ok(biggest < 25 * 1024 * 1024, "largest asset is " + Math.round(biggest / 1024 / 1024) + " MiB (>25 MiB limit)");

const ogFiles = files.filter((f) => f.includes(join("out", "og") + sep()) || f.includes("/og/"));
ok(ogFiles.length >= 1, "no generated OG cards in out/og");

const html = files.filter((f) => extname(f) === ".html");
ok(html.length >= 85, "only " + html.length + " prerendered HTML files");
for (const f of html) {
  const body = readFileSync(f, "utf8");
  if (body.includes("/_next/image")) failures.push("HTML contains /_next/image: " + f);
  // Metadata must use the static cards; article prose may legitimately mention
  // the old query URL, so only assert on the meta tag itself.
  const ogMeta = body.match(/property="og:image" content="([^"]+)"/);
  if (ogMeta && ogMeta[1].includes("/og?")) failures.push("og:image still points at dynamic /og?: " + f);
}

const headers = readFileSync(join(OUT, "_headers"), "utf8");
for (const needle of ["/rss", "application/rss+xml", "/og/*", "immutable"]) {
  if (!headers.includes(needle)) failures.push("_headers missing rule: " + needle);
}

if (failures.length) {
  console.error("verify-export FAILED:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("verify-export OK: " + files.length + " files, " + html.length + " HTML, " + ogFiles.length + " OG cards, largest " + (biggest / 1024).toFixed(0) + " KB");
function sep() { return process.platform === "win32" ? "\\" : "/"; }