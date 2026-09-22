/**
 * One-shot: move public/static/** into data/static/**, leaving public/static
 * free for the link. Safe to re-run — it no-ops once the move is done.
 *
 * Run: node scripts/migrate-static-assets.mjs
 */
import { existsSync, lstatSync, mkdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FROM = path.join(ROOT, "public", "static");
const TO = path.join(ROOT, "data", "static");

if (existsSync(TO) && lstatSync(TO).isDirectory() && !lstatSync(TO).isSymbolicLink()) {
  if (!existsSync(FROM)) {
    console.log("already migrated");
    process.exit(0);
  }
  if (!lstatSync(FROM).isDirectory() || lstatSync(FROM).isSymbolicLink()) {
    console.log("already migrated (source is a link)");
    process.exit(0);
  }
  throw new Error(`${TO} and ${FROM} are both real directories; resolve manually`);
}

if (!existsSync(FROM)) throw new Error(`nothing to move: ${FROM} missing`);

mkdirSync(path.dirname(TO), { recursive: true });
renameSync(FROM, TO);
console.log(`moved ${FROM} -> ${TO}`);
