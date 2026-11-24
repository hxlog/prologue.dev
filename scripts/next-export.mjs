/**
 * Cross-platform entry for the static export build.
 *
 * package.json only has to say "node scripts/next-export.mjs": the NEXT_EXPORT
 * flag next.config.js reads is set here, so the command works on Windows cmd,
 * POSIX shells and CI alike (the "FOO=1 cmd" form does not work on cmd.exe).
 */
import { spawnSync } from "node:child_process";

const result = spawnSync(
  process.execPath,
  ["node_modules/next/dist/bin/next", "build", "--turbopack"],
  { stdio: "inherit", env: { ...process.env, NEXT_EXPORT: "1" } }
);

process.exit(result.status ?? 1);
