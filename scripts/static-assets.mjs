/**
 * Maintains the link that lets Next serve data/static at /static/* while the
 * files themselves live in the vault.
 *
 *   data/static/                     <- the real files (in git, in the vault)
 *   public/static -> ../data/static  <- what Next serves
 *
 * Why a link and not a route handler: it keeps /static/* on Next's static file
 * path, so every image request is a file read rather than a function
 * invocation, and it survives `git clone` on any platform because only the
 * TARGET is committed.
 *
 * On Windows a directory junction needs no elevation; a real symlink does. Git
 * checks links out as plain files when core.symlinks=false, so on Windows the
 * junction is created explicitly rather than relying on checkout.
 *
 * Usage: node scripts/static-assets.mjs <link|unlink|verify>
 */
import { existsSync, lstatSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TARGET = path.join(ROOT, "data", "static");
const LINK = path.join(ROOT, "public", "static");
const isWindows = process.platform === "win32";

function command(cmd, args) {
  const result = spawnSync(cmd, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed\n${result.stderr || result.stdout}`);
  }
}

function link() {
  if (!existsSync(TARGET)) {
    // Not an error: an interrupted Task 7 leaves this state, and dev must not
    // be blocked by it. The migration script is the thing that creates it.
    console.warn(`static: skipped, ${TARGET} does not exist yet`);
    return;
  }
  if (existsSync(LINK)) {
    if (lstatSync(LINK).isSymbolicLink()) {
      console.log(`static: link already present`);
      return;
    }
    throw new Error(
      `${LINK} exists and is a real directory. Its contents should already live ` +
        `in data/static; remove it to create the link.`
    );
  }
  mkdirSync(path.dirname(LINK), { recursive: true });
  if (isWindows) {
    command("cmd", ["/c", "mklink", "/J", LINK, TARGET]);
  } else {
    symlinkSync(path.relative(path.dirname(LINK), TARGET), LINK);
  }
  console.log(`static: linked ${LINK} -> ${TARGET}`);
}

function unlink() {
  if (!existsSync(LINK)) return;
  if (!lstatSync(LINK).isSymbolicLink()) {
    throw new Error(`${LINK} is a real directory; refusing to remove`);
  }
  if (isWindows) command("cmd", ["/c", "rmdir", LINK]);
  else rmSync(LINK, { force: true });
  console.log(`static: unlinked ${LINK}`);
}

/**
 * `verify` is the one that matters in CI and before a deploy: it proves the
 * link is present, is a link, and actually resolves to the asset tree.
 */
function verify() {
  if (!existsSync(TARGET)) throw new Error(`missing ${TARGET}`);
  if (!existsSync(LINK)) throw new Error(`missing ${LINK} — run: npm run static:link`);
  if (!lstatSync(LINK).isSymbolicLink()) throw new Error(`${LINK} is not a link`);
  const probe = path.join(LINK, "favicons", "avatar.png");
  if (!existsSync(probe)) {
    throw new Error(`${LINK} does not resolve to the asset tree (no ${probe})`);
  }
  console.log(`static: OK (${LINK} -> ${TARGET})`);
}

const cmd = process.argv[2];
if (cmd === "link") link();
else if (cmd === "unlink") unlink();
else if (cmd === "verify") verify();
else {
  console.error("usage: node scripts/static-assets.mjs <link|unlink|verify>");
  process.exit(1);
}
