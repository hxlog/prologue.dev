#!/usr/bin/env node
/**
 * Create or update the single account.
 *
 *   node --env-file=.env.local scripts/admin/bootstrap.mjs
 *   node --env-file=.env.local scripts/admin/bootstrap.mjs --email you@example.com
 *
 * There is no sign-up route, by design — see src/lib/auth/users.js. This script
 * is the only way a user comes into existence, which means it is also the only
 * thing that needs a strong password check.
 *
 * The password is read from an interactive prompt, never from argv or the
 * environment: a password on the command line is in the shell history and in
 * `ps` output, and one in `.env.local` is in a file that a later `git add -A`
 * can sweep up. It is typed, hashed, and discarded.
 *
 * Re-running on an existing account updates the password and, unless
 * --keep-sessions is passed, signs every browser out. That is the recovery
 * path when 2FA is lost AND the backup codes are lost, and it is deliberately
 * a thing you can only do with shell access to the server.
 *
 *   --keep-2fa        do not reset TOTP state when updating a password
 *   --keep-sessions   do not invalidate existing sessions
 */

import { createInterface } from "node:readline";
import { argv, env, exit, stdin, stdout } from "node:process";
import { pathToFileURL } from "node:url";
import path from "node:path";
import pg from "pg";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

const { hashPassword } = await import(
  pathToFileURL(path.join(ROOT, "src/lib/auth/password.js")).href
);

const args = new Set(argv.slice(2));
const KEEP_2FA = args.has("--keep-2fa");
const KEEP_SESSIONS = args.has("--keep-sessions");

function argValue(flag) {
  const index = argv.indexOf(flag);
  return index === -1 ? null : argv[index + 1] ?? null;
}

/**
 * Minimum password rules.
 *
 * Length only, and a low bar: composition rules produce `Password1!` and the
 * author is the only user. 12 characters is the number that makes an offline
 * attack on a leaked hash impractical, which is the threat that actually
 * exists here — there is no public form to guess against.
 */
const MIN_LENGTH = 12;

function validate(password, confirmation) {
  if (password.length < MIN_LENGTH) {
    return `Password must be at least ${MIN_LENGTH} characters (got ${password.length}).`;
  }
  if (password !== confirmation) {
    return "Passwords do not match.";
  }
  if (/^\s|\s$/.test(password)) {
    return "Password must not start or end with whitespace.";
  }
  return null;
}

/**
 * Read a line without echoing it.
 *
 * readline has no hidden mode. The approach is to let readline own the prompt
 * and the input handling, but replace its output method with a no-op for the
 * duration, and write the prompt ourselves so the operator can still see what
 * is being asked. Restoring the original method matters: rl.close() is not
 * enough on its own, because readline writes the trailing newline itself.
 */
function askHidden(prompt) {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: stdin, output: stdout, terminal: true });

    // Ctrl-C at a password prompt aborts the script. Without this, readline
    // closes and question() resolves with an empty string, which the length
    // check would then report as "too short" — hiding the fact that the
    // operator asked to stop.
    rl.on("SIGINT", () => {
      rl.close();
      stdout.write("\n");
      exit(130);
    });

    const writeToOutput = rl._writeToOutput;
    rl._writeToOutput = () => {};

    stdout.write(prompt);
    rl.question("", (answer) => {
      rl._writeToOutput = writeToOutput;
      rl.close();
      stdout.write("\n");
      resolve(answer);
    });
    rl.on("error", reject);
  });
}

async function promptPassword() {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const password = await askHidden("New password: ");
    const confirmation = await askHidden("Confirm:      ");
    const error = validate(password, confirmation);
    if (!error) return password;
    console.error(`  ${error}`);
    if (attempt === 3) {
      console.error("\nGiving up after three attempts.");
      exit(1);
    }
  }
  return null;
}

const email = (argValue("--email") || env.OWNER_EMAIL || "").trim().toLowerCase();

if (!email) {
  console.error(
    "No email.\n" +
      "Set OWNER_EMAIL in .env.local, or pass --email you@example.com.\n" +
      "This must match OWNER_EMAIL: src/lib/auth/users.js refuses to sign in\n" +
      "any address that does not, so a mismatch produces an account nobody can use."
  );
  exit(1);
}

if (env.OWNER_EMAIL && email !== env.OWNER_EMAIL.trim().toLowerCase()) {
  console.error(
    `--email (${email}) does not match OWNER_EMAIL (${env.OWNER_EMAIL}).\n` +
      "Refusing: the account would exist but be unable to sign in."
  );
  exit(1);
}

const url = env.PGADMIN_URL || env.DATABASE_URL_UNPOOLED;
if (!url) {
  console.error("Set PGADMIN_URL (or DATABASE_URL_UNPOOLED) in .env.local.");
  exit(1);
}
if (url.includes(":6432")) {
  console.error("Refusing to run through PgBouncer (port 6432). Use the direct URL.");
  exit(1);
}

console.log(`\nAccount: ${email}\n`);

const client = new pg.Client({ connectionString: url, application_name: "prologue-bootstrap" });
await client.connect();

try {
  const { rows: existing } = await client.query(
    `SELECT id, totp_enabled FROM users WHERE email = $1`,
    [email]
  );

  if (existing.length) {
    const user = existing[0];
    console.log("An account with this address already exists.");
    console.log(`  TOTP: ${user.totp_enabled ? "enabled" : "disabled"}`);
    console.log("\nThis will REPLACE the password.");
    if (!KEEP_2FA) {
      console.log("And RESET two-factor authentication (pass --keep-2fa to keep it).");
    }
    if (!KEEP_SESSIONS) {
      console.log("And SIGN OUT every browser (pass --keep-sessions to keep them).");
    }
    console.log("");

    const password = await promptPassword();
    const hash = await hashPassword(password);

    await client.query("BEGIN");

    if (KEEP_2FA) {
      await client.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [
        user.id,
        hash,
      ]);
    } else {
      // Clearing the TOTP columns is the whole recovery story: a lost
      // authenticator plus lost backup codes is recoverable by someone who can
      // already run shell commands on the server, and by nobody else.
      await client.query(
        `UPDATE users
            SET password_hash = $2,
                totp_secret = NULL,
                totp_enabled = false,
                totp_verified_at = NULL,
                totp_last_step = NULL
          WHERE id = $1`,
        [user.id, hash]
      );
      await client.query(`DELETE FROM totp_backup_codes WHERE user_id = $1`, [user.id]);
    }

    if (!KEEP_SESSIONS) {
      await client.query(`DELETE FROM sessions WHERE user_id = $1`, [user.id]);
    }
    // Any in-flight second factor is void the moment the password changes.
    await client.query(`DELETE FROM login_challenges WHERE user_id = $1`, [user.id]);

    await client.query("COMMIT");

    console.log("\nUpdated.");
    if (!KEEP_SESSIONS) console.log("  Every session was signed out.");
    if (!KEEP_2FA) console.log("  2FA was reset; enable it again in /studio/settings.");
  } else {
    const { rows: anyUser } = await client.query(`SELECT count(*)::int AS n FROM users`);
    if (anyUser[0].n > 0) {
      console.error(
        "A different account already exists, and there is only meant to be one.\n" +
          "This script will not create a second. To change the address, update the\n" +
          "existing row first, or drop it and re-run."
      );
      exit(1);
    }

    const password = await promptPassword();
    const hash = await hashPassword(password);

    await client.query(
      `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3)`,
      [email, "槐序", hash]
    );

    console.log("\nCreated.");
    console.log("  Sign in at /studio/login. Enable 2FA at /studio/settings once in.");
  }
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("\nFAILED:", err.message);
  exit(1);
} finally {
  await client.end();
}
