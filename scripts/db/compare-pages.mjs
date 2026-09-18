#!/usr/bin/env node
/**
 * Compare the local build against the live site, page by page.
 *
 *   node scripts/db/compare-pages.mjs [--local http://localhost:3210]
 *
 * Compares the *text content* rather than the raw HTML: Next's dev/prod builds
 * and the CDN both rewrite asset URLs, inline different chunk hashes and vary
 * whitespace, so a byte diff would be entirely noise. Extracting visible text
 * answers the question that actually matters — does the reader see the same
 * thing — and any real difference shows up as a line in the report.
 *
 * Not a test suite. It is the check run once at the end of the migration, and
 * worth keeping for the next one.
 */

import process from "node:process";

const LOCAL = process.env.LOCAL_BASE || "http://localhost:3210";
const LIVE = process.env.LIVE_BASE || "https://prologue.dev";

const PATHS = process.argv.slice(2).filter((a) => a.startsWith("/"));

const DEFAULT_PATHS = [
  "/",
  "/blog",
  "/about",
  "/microblog",
  "/links",
  "/tags/Economics",
  "/tags/Web3",
  "/blog/2023-introduction-to-articles",
  "/blog/land-finance-and-the-financing-dilemma-of-public-goods",
  "/blog/is-there-a-new-logic-behind-bitcoin-in-2026",
];

/**
 * Strip everything that legitimately differs between two hosts serving the
 * same content: the head, scripts, styles, and whitespace runs.
 *
 * `<style>` and `<script>` content is removed wholesale rather than parsed —
 * inline RSC payload is embedded in script tags and is full of host-specific
 * escaping, and no part of it is visible text.
 */
function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<head[\s\S]*?<\/head>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    // SVG is iconography; its path data churns with no visible change.
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { "user-agent": "prologue-migration-check" } });
  if (!res.ok) return { status: res.status, text: "" };
  return { status: res.status, text: visibleText(await res.text()) };
}

/**
 * Longest common subsequence length is overkill; what is useful is *where* two
 * texts diverge, so report the first differing window and the length delta.
 */
function describe(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  let j = 0;
  while (
    j < a.length - i &&
    j < b.length - i &&
    a[a.length - 1 - j] === b[b.length - 1 - j]
  ) {
    j++;
  }
  return {
    offset: i,
    local: a.slice(Math.max(0, i - 60), i + 160),
    live: b.slice(Math.max(0, i - 60), i + 160),
    lengthDelta: a.length - b.length,
  };
}

const paths = PATHS.length ? PATHS : DEFAULT_PATHS;
let failures = 0;

for (const p of paths) {
  const [local, live] = await Promise.all([
    fetchText(`${LOCAL}${p}`),
    fetchText(`${LIVE}${p}`),
  ]);

  const label = p.padEnd(58);

  if (local.status !== live.status) {
    console.log(`${label} STATUS  local=${local.status} live=${live.status}`);
    failures++;
    continue;
  }

  if (local.text === live.text) {
    console.log(`${label} ok  (${local.text.length} chars)`);
    continue;
  }

  failures++;
  const d = describe(local.text, live.text);
  console.log(`${label} DIFF  delta=${d.lengthDelta} at offset ${d.offset}`);
  console.log(`    local: …${d.local}…`);
  console.log(`    live : …${d.live}…`);
}

console.log(
  failures === 0
    ? `\nAll ${paths.length} page(s) match.`
    : `\n${failures} of ${paths.length} page(s) differ.`
);
process.exitCode = failures === 0 ? 0 : 1;
