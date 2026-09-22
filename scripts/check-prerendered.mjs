/**
 * Post-build gate: every prerendered page must be intact. Checks, across the
 * whole .next/server/app output rather than one sample page:
 *   - no comma-joined class attribute anywhere (the F1 defect signature)
 *   - every in-page `href="#id"` resolves to a real id on that page (F2)
 *   - the about page renders its markdown through the pipeline
 * The .next output is what a reader actually receives, so it catches mistakes
 * the render harness cannot see (a component that drops the HTML, for one).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const APP = path.join(ROOT, ".next", "server", "app");

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".html")) out.push(full);
  }
  return out;
}

let failures = 0;
let pages = 0;
let anchors = 0;
const deadByPage = [];

for (const file of walk(APP)) {
  pages++;
  const rel = path.relative(APP, file).replace(/\\/g, "/");
  const html = readFileSync(file, "utf8");

  const comma = html.match(/class="[^"]*,[^"]*"/g);
  if (comma) {
    console.error(`FAIL ${rel}: ${comma.length} comma-joined class(es): ${comma[0]}`);
    failures++;
  }

  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  const hrefs = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
  anchors += hrefs.length;
  const dead = [...new Set(hrefs.filter((a) => !ids.has(a)))];
  if (dead.length) {
    deadByPage.push(`${rel}: ${dead.slice(0, 5).join(", ")}`);
    failures++;
  }
}

const about = readFileSync(path.join(APP, "about.html"), "utf8");
if (!about.includes("/static/favicons/avatar.png")) {
  console.error("FAIL about: avatar image missing");
  failures++;
}
if (!/关于作者/.test(about)) {
  console.error("FAIL about: heading text missing");
  failures++;
}

const post = readFileSync(path.join(APP, "blog", "2024-economic-watch-not-wasting-a-crisis.html"), "utf8");
if (!post.includes("rounded-lg mx-auto lightbox-image cursor-zoom-in")) {
  console.error("FAIL post: F1 class missing");
  failures++;
}
if (!/<figure/.test(post)) {
  console.error("FAIL post: no <figure> in body");
  failures++;
}

for (const line of deadByPage) console.error(`FAIL dead anchor ${line}`);

console.log(
  `prerendered check: ${pages} pages, ${anchors} in-page anchors, ${failures} failure(s)`
);
process.exit(failures === 0 ? 0 : 1);
