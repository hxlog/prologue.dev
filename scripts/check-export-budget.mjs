import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";

/**
 * Performance budget for the exported site.
 *
 * Static pages are cached immutably at the edge, but the browser still pays for
 * the initial JS/CSS/HTML. This guard measures the real exported bytes (not
 * source estimates): every <script>/modulepreload/stylesheet referenced by a
 * representative page, gzipped at level 9. It runs in CI after the export so a
 * change that ships duplicate browser dependencies or a larger HTML shell fails
 * the build instead of silently regressing Core Web Vitals.
 *
 * Thresholds are deliberately a little above today's measured values; tighten
 * them when a change actually removes bytes, never loosen them casually.
 */
const OUT = path.resolve("out");
const BUDGETS = {
  "index.html": { js: 220 * 1024, css: 20 * 1024, html: 50 * 1024 },
  "blog/evaluating-ai-data-labeling-accuracy.html": { js: 220 * 1024, css: 20 * 1024, html: 50 * 1024 },
  "blog.html": { js: 220 * 1024, css: 20 * 1024, html: 50 * 1024 },
  "about.html": { js: 220 * 1024, css: 20 * 1024, html: 50 * 1024 },
  "tags/Philosophy.html": { js: 220 * 1024, css: 20 * 1024, html: 50 * 1024 },
};

const gz = (buffer) => gzipSync(buffer, { level: 9 }).length;
const toOutPath = (url) => path.join(OUT, decodeURIComponent(url.split("?")[0]));

const failures = [];
const rows = [];

for (const [page, budget] of Object.entries(BUDGETS)) {
  const htmlPath = path.join(OUT, page);
  const html = readFileSync(htmlPath);
  const source = html.toString("utf8");

  const js = [
    ...new Set(
      [...source.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]).concat(
        [...source.matchAll(/<link[^>]+rel="(?:modulepreload|preload)"[^>]+href="([^"]+\.js)"/g)].map(
          (m) => m[1]
        )
      )
    ),
  ];
  const css = [...new Set([...source.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map((m) => m[1]))];

  const jsGz = js.reduce((total, url) => total + gz(readFileSync(toOutPath(url))), 0);
  const cssGz = css.reduce((total, url) => total + gz(readFileSync(toOutPath(url))), 0);
  const htmlGz = gz(html);

  rows.push({ page, jsFiles: js.length, jsGz, cssGz, htmlGz });

  if (jsGz > budget.js) failures.push(page + ": initial JS " + Math.round(jsGz / 1024) + " KiB > " + budget.js / 1024 + " KiB");
  if (cssGz > budget.css) failures.push(page + ": CSS " + Math.round(cssGz / 1024) + " KiB > " + budget.css / 1024 + " KiB");
  if (htmlGz > budget.html) failures.push(page + ": HTML " + Math.round(htmlGz / 1024) + " KiB > " + budget.html / 1024 + " KiB");
}

console.log("export budget (gzip):");
for (const row of rows) {
  console.log(
    "  " + row.page.padEnd(48) + " js=" + String(row.jsFiles).padStart(2) + " files/" + Math.round(row.jsGz / 1024) + " KiB" +
    "  css=" + Math.round(row.cssGz / 1024) + " KiB  html=" + Math.round(row.htmlGz / 1024) + " KiB"
  );
}

if (failures.length > 0) {
  console.error("export budget FAILED:");
  for (const failure of failures) console.error("  - " + failure);
  process.exit(1);
}
console.log("export budget OK");
