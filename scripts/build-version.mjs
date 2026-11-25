import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Writes public/version.json before next build.
 *
 * A static deployment can leave an open tab running the previous build; the
 * client version guard reloads when this value changes. Git SHA is ideal (it
 * changes exactly when the repo content changes); the timestamp is a fallback
 * for checkouts without git metadata.
 */
let version = "";
try {
  const result = spawnSync("git", ["rev-parse", "--short=12", "HEAD"], { encoding: "utf8" });
  if (result.status === 0) version = result.stdout.trim();
} catch {
  /* fall through */
}
if (!version) version = String(Date.now());

const payload = { version, generatedAt: new Date().toISOString() };
writeFileSync(path.join(process.cwd(), "public", "version.json"), JSON.stringify(payload) + "\n");
console.log("version.json:", version);
