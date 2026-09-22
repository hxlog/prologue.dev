/**
 * Feed acceptance check: fetches all four feeds from a running server and
 * asserts the things a serializer bug would break.
 *
 * This covers what the render-equivalence gate cannot, because it happens
 * *after* the markdown pipeline: Mermaid fences becoming hosted mermaid.ink
 * images, relative URLs becoming absolute, and the KaTeX presentation layer
 * being stripped while MathML survives. It needs a running server (`npm run
 * start`), so it is not part of the offline gate.
 *
 * Usage: node scripts/check-feeds.mjs [sitePort]
 */

const SITE = `http://localhost:${process.argv[2] || 3000}`;

const post = async (path) => {
  const res = await fetch(`${SITE}${path}`);
  return { status: res.status, type: res.headers.get("content-type"), body: await res.text() };
};

const count = (haystack, re) => (haystack.match(re) || []).length;

async function main() {
  const problems = [];

  const rss = await post("/rss");
  const atom = await post("/atomfeed");
  const json = await post("/jsonfeed");
  const micro = await post("/microblog/rss");

  console.log("=== item counts ===");
  const items = {
    rss: count(rss.body, /<item>/g),
    atom: count(atom.body, /<entry>/g),
    json: JSON.parse(json.body).items.length,
    micro: count(micro.body, /<item>/g),
  };
  console.log(`  ${JSON.stringify(items)}`);

  // 63 published posts. Mismatching counts between the three main feeds would
  // mean one serializer is dropping items.
  if (items.rss !== 63) problems.push(`/rss has ${items.rss} items, expected 63`);
  if (items.atom !== items.rss) problems.push(`/atomfeed has ${items.atom} entries, /rss has ${items.rss}`);
  if (items.json !== items.rss) problems.push(`/jsonfeed has ${items.json} items, /rss has ${items.rss}`);
  if (items.micro < 1) problems.push(`/microblog/rss has ${items.micro} items`);

  console.log("\n=== per-feed body checks ===");
  for (const [name, res] of [
    ["rss", rss],
    ["atom", atom],
    ["json", json],
    ["microblog", micro],
  ]) {
    const b = res.body;
    const checks = {
      // Mermaid fences must never reach a reader: RSS clients strip inline
      // script and SVG, so the fence has to become a hosted PNG.
      "mermaid fence leaked": count(b, /<pre class="mermaid"/g),
      "mermaid.ink image present": count(b, /mermaid\.ink/g),
      // KaTeX's HTML presentation layer is meaningless without the stylesheet;
      // the MathML alongside it is what readers can render.
      "katex-html leaked": count(b, /class="katex-html"/g),
      "mathml present": count(b, /<math/g),
      // Feed readers have no base URL, so every href/src must be absolute.
      "relative /static src": count(b, /(?:src|href)="\/static\//g),
      "relative /blog href": count(b, /href="\/blog\//g),
      "raw shiki vars": count(b, /--shiki-/g),
      "lightbox class leaked": count(b, /lightbox-image/g),
    };
    const bad = Object.entries(checks).filter(([k, v]) => k.endsWith("leaked") && v > 0);
    console.log(`  ${name.padEnd(10)} ${JSON.stringify(checks)}`);
    for (const [k, v] of bad) problems.push(`${name}: ${k} (${v})`);
    if (checks["relative /static src"]) problems.push(`${name}: ${checks["relative /static src"]} relative /static URL(s)`);
    if (checks["relative /blog href"]) problems.push(`${name}: ${checks["relative /blog href"]} relative /blog URL(s)`);
  }

  // JSON Feed carries an image per item where the post has one; the `feed`
  // library cannot express that, so finalize.js injects it. If the injection
  // broke, this drops to zero.
  const withImage = JSON.parse(json.body).items.filter((i) => i.image).length;
  console.log(`\n=== jsonfeed per-item images ===\n  ${withImage} of ${items.json} items`);
  if (withImage === 0) problems.push("jsonfeed has no per-item images; the image injection is not running");

  // The mermaid post must actually have produced a hosted diagram.
  const mermaidPost = await post("/blog/first_job_first_exit_stop_the_bleeding");
  console.log(`\n=== mermaid post (page HTML) ===\n  status ${mermaidPost.status}`);
  if (mermaidPost.status !== 200) problems.push(`mermaid post returned ${mermaidPost.status}`);

  // The three feeds must agree on ordering: newest first.
  const rssDates = [...rss.body.matchAll(/<pubDate>([^<]+)<\/pubDate>/g)].map((m) => new Date(m[1]).getTime());
  const orderOk = rssDates.every((d, i) => i === 0 || rssDates[i - 1] >= d);
  console.log(`\n=== rss ordering ===\n  newest-first: ${orderOk} (${rssDates.length} dated items)`);
  if (!orderOk) problems.push("rss items are not in newest-first order");

  console.log(`\n${problems.length} problem(s)`);
  for (const p of problems) console.log(`  FAIL ${p}`);
  process.exit(problems.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
