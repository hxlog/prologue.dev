/**
 * One entry point for every acceptance gate.
 *
 * These are NOT part of `build`, and three of them cannot be. `build` produces
 * an artifact; these verify invariants about it:
 *
 *   - `prerendered` reads `.next/server/app/**`, so it must run *after* build.
 *   - `feeds` fetches all four feeds from a running server (`npm run start`).
 *   - `template` inspects the files the published starter ships, which this
 *     site never uses.
 *
 * Folding them into `build` would also break the public template: a stranger's
 * clone does not carry `scripts/fixtures/`, so `npm run build` would fail on a
 * missing baseline instead of producing a site.
 *
 * Usage:
 *   node scripts/check.mjs                 offline gates: static link, slug,
 *                                          render, content, template
 *   node scripts/check.mjs prerendered     anchors in the built output
 *   node scripts/check.mjs feeds [port]    the four feeds, against `npm run start`
 *   node scripts/check.mjs all             offline, then prerendered, then feeds
 *
 * Exit: 0 = every gate passed, 1 = at least one failed
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Each offline gate is one child process. They are run even after one fails --
// a formatting regression and an equivalence regression are different problems
// and seeing both beats re-running the whole suite to find the second.
const OFFLINE = [
  ["static", "scripts/static-assets.mjs", ["link", "verify"]],
  ["site-data", "scripts/build-site-data.mjs", ["--check"]],
  ["site-data-template", "scripts/build-site-data.mjs", ["--check", "--template"]],
  ["slug", "scripts/check-slug-parity.mjs", []],
  ["render", "scripts/check-render-equivalence.mjs", []],
  ["content", "scripts/check-content-shape.mjs", []],
  ["template", "scripts/check-template.mjs", []],
];

const [command = "offline", ...rest] = process.argv.slice(2);

const plan = buildPlan(command, rest);
if (!plan) {
  console.error(
    "usage: node scripts/check.mjs [offline|prerendered|feeds|all] [port]"
  );
  process.exit(1);
}

const results = [];
for (const [name, script, args] of plan) {
  console.log(`\n=== ${name} ===`);
  const { status } = spawnSync(process.execPath, [script, ...args], {
    cwd: ROOT,
    stdio: "inherit",
  });
  results.push([name, status === 0]);
}

const failed = results.filter(([, ok]) => !ok);
console.log("\n" + "-".repeat(48));
for (const [name, ok] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
console.log("-".repeat(48));

process.exit(failed.length === 0 ? 0 : 1);

function buildPlan(command, rest) {
  const prerendered = ["prerendered", "scripts/check-prerendered.mjs", []];
  const feeds = ["feeds", "scripts/check-feeds.mjs", rest.slice(0, 1)];

  // `static` runs `link` before `verify`: the link is what `dev`/`build` create,
  // and both subcommands are idempotent, so this works on a fresh clone instead
  // of failing on a missing public/static.
  switch (command) {
    case "offline":
      return OFFLINE;
    case "prerendered":
      return [prerendered];
    case "feeds":
      return [feeds];
    case "all":
      return [...OFFLINE, prerendered, feeds];
    default:
      return null;
  }
}
