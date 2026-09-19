/**
 * Reconcile the media table against the Blob store.
 *
 * A script rather than a screen, because neither of the two things it reports is
 * something the author can act on from a UI.
 *
 *   - **Orphan blob** — bytes in the store with no row. Only reachable when a
 *     commit failed after a successful PUT: the tab was closed between steps 2
 *     and 3, or the function died. Invisible by definition, because every screen
 *     reads the database.
 *
 *   - **Dangling row** — a row whose object is gone. Reachable if somebody
 *     deleted directly in the Vercel dashboard. It renders as a broken image
 *     everywhere the pathname appears.
 *
 * `--fix` deletes orphan blobs and dangling rows. It is never the default:
 * deleting an object that a row is one column away from referencing would be
 * unrecoverable, and a report the author reads first costs nothing.
 *
 *   node --env-file=.env.local scripts/studio/media-reconcile.mjs [--fix]
 */

import { list, head, del } from "@vercel/blob";
import { pool } from "../../src/lib/db/index.js";

const fix = process.argv.includes("--fix");
const now = new Date();

// Every blob under media/, paginated. `list` caps at 1000 per call.
const blobs = [];
let cursor;
do {
  const page = await list({ prefix: "media/", cursor, limit: 1000 });
  blobs.push(...page.blobs);
  cursor = page.hasMore ? page.cursor : undefined;
} while (cursor);

const { rows } = await pool.query(`SELECT id, pathname FROM media`);
const known = new Map(rows.map((r) => [r.pathname, r.id]));

const orphans = blobs.filter((b) => !known.has(b.pathname));

// Dangling rows are checked one `head` at a time because the store has no
// "give me these forty keys" call. It is bounded by the table, and the table is
// a library one person maintains.
const dangling = [];
for (const row of rows) {
  if (!blobs.some((b) => b.pathname === row.pathname)) {
    try {
      await head(row.pathname);
    } catch {
      dangling.push(row);
    }
  }
}

const orphanBytes = orphans.reduce((sum, b) => sum + (b.size ?? 0), 0);

console.log(`store objects : ${blobs.length}`);
console.log(`media rows    : ${rows.length}`);
console.log(`orphan blobs  : ${orphans.length}${orphanBytes ? ` (${mb(orphanBytes)})` : ""}`);
console.log(`dangling rows : ${dangling.length}`);
console.log(`checked at    : ${now.toISOString()}`);

for (const b of orphans.slice(0, 30)) console.log(`  orphan   ${b.pathname}`);
if (orphans.length > 30) console.log(`  … and ${orphans.length - 30} more`);
for (const r of dangling.slice(0, 30)) console.log(`  dangling ${r.pathname}`);
if (dangling.length > 30) console.log(`  … and ${dangling.length - 30} more`);

if (!fix) {
  console.log("\nReport only. Re-run with --fix to remove the above.");
} else {
  for (const b of orphans) await del(b.pathname);
  for (const r of dangling) await pool.query(`DELETE FROM media WHERE id = $1`, [r.id]);
  console.log(`\nRemoved ${orphans.length} orphan blob(s) and ${dangling.length} row(s).`);
}

await pool.end();

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
