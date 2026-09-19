/**
 * A Node ESM resolve hook that lets the repo's extensionless relative imports
 * work outside a bundler.
 *
 * The application code writes `import { query } from "../db"` — no extension —
 * because Turbopack resolves it. Plain Node does not: ESM requires a full
 * specifier, so the same file that Next compiles happily throws
 * ERR_MODULE_NOT_FOUND when a test script imports it.
 *
 * Rewriting the imports inside src/lib would make them work in both, but it
 * would also be a change to shipped code made for the benefit of a test
 * harness, and `@/*` is explicitly unused in this repo (see CLAUDE.md) — the
 * extensionless form is the house style. So the resolution gap is closed here,
 * on the test side, where it belongs.
 *
 * Registered with:
 *   node --env-file=.env.local --import ./scripts/auth/register-loader.mjs \
 *     scripts/auth/auth-test.mjs
 */

import { register } from "node:module";
import { fileURLToPath } from "node:url";

// Resolved against THIS file, not the working directory: register() is passed a
// URL, and a bare "./extension-loader.mjs" would be resolved against a base the
// module loader picks, which is not guaranteed to be this directory.
register(new URL("./extension-loader.mjs", import.meta.url));
