import { spawnSync } from "node:child_process";

/**
 * Test-only production build. The testing API must be enabled at build time,
 * not just at start, so this script sets the flag and runs the same two steps
 * as yarn build.
 */
const env = { ...process.env, EXPOSE_TESTING_API: "1" };

function run(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(["scripts/build-search-index.mjs"]);
run(["node_modules/next/dist/bin/next", "build", "--turbopack"]);
