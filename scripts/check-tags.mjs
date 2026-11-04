#!/usr/bin/env node
/**
 * Tag hygiene report.
 *
 * The taxonomy is deliberately small: 15 canonical English slugs, with Chinese
 * display labels in data/tagLabels.js. This script does not re-tag anything --
 * it reports the states that make a taxonomy stop working as a browsing aid:
 *
 *   ERROR  a tag used by a post that is not in tagLabels.js  (dead link target)
 *   WARN   a post with 0 or 1 tags                          (unreachable from
 *                                                            any tag page)
 *   WARN   a canonical tag with fewer than 3 posts           (a one-post page)
 *   INFO   the distribution
 *
 * Reads public/search-index.json, which `yarn build` regenerates, so it runs in
 * a second without touching the content pipeline. Exit code is 1 only on ERROR.
 *
 *   node scripts/check-tags.mjs          report
 *   node scripts/check-tags.mjs --json   machine-readable
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import tagLabels from "../data/tagLabels.js";

const ROOT = process.cwd();
const INDEX = path.join(ROOT, "public", "search-index.json");
const asJson = process.argv.includes("--json");

let posts;
try {
  posts = JSON.parse(readFileSync(INDEX, "utf8"));
} catch {
  console.error(`Cannot read ${INDEX}. Run \`yarn build\` (or \`node scripts/build-search-index.mjs\`) first.`);
  process.exit(1);
}

const canonical = new Set(Object.keys(tagLabels));
const counts = new Map();
const unknown = new Map();
const thinPosts = [];

for (const post of posts) {
  const tags = Array.isArray(post.tags) ? post.tags : [];
  if (tags.length < 2) thinPosts.push({ slug: post.slug, title: post.title, tags });

  for (const tag of tags) {
    if (!canonical.has(tag)) {
      if (!unknown.has(tag)) unknown.set(tag, []);
      unknown.get(tag).push(post.slug);
    }
    counts.set(tag, (counts.get(tag) || 0) + 1);
  }
}

const distribution = [...counts.entries()].sort((a, b) => b[1] - a[1]);
const rare = distribution.filter(([tag, n]) => canonical.has(tag) && n < 3);
const unused = [...canonical].filter((tag) => !counts.has(tag));

if (asJson) {
  console.log(
    JSON.stringify(
      {
        posts: posts.length,
        distribution: Object.fromEntries(distribution),
        unknown: Object.fromEntries(unknown),
        thinPosts,
        rare,
        unused,
      },
      null,
      2
    )
  );
} else {
  console.log(`${posts.length} posts, ${counts.size} tags in use of ${canonical.size} canonical\n`);
  console.log("Distribution");
  for (const [tag, n] of distribution) {
    console.log(`  ${tag.padEnd(14)} ${String(n).padStart(3)}${canonical.has(tag) ? "" : "   <- NOT CANONICAL"}`);
  }

  if (unused.length) console.log(`\nUnused canonical tags: ${unused.join(", ")}`);

  if (thinPosts.length) {
    console.log(`\nPosts reachable from fewer than two tags (${thinPosts.length}):`);
    for (const p of thinPosts) console.log(`  ${(p.tags.join(",") || "(none)").padEnd(18)} ${p.slug}`);
  }

  if (rare.length) {
    console.log("\nTags with fewer than three posts:");
    for (const [tag, n] of rare) console.log(`  ${tag} (${n})`);
  }

  if (unknown.size) {
    console.log("\nERROR unknown tags (not in data/tagLabels.js, so /tags/<slug> 404s):");
    for (const [tag, slugs] of unknown) console.log(`  ${tag}: ${slugs.join(", ")}`);
  }

  const problem = unknown.size > 0;
  console.log(`\n${problem ? "FAIL" : "OK"}`);
  process.exitCode = problem ? 1 : 0;
}
