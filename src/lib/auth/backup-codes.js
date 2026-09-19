/**
 * Backup codes.
 *
 * What they are for: the author loses their phone, or the authenticator app's
 * database, and cannot produce a code. Without backup codes the only recovery
 * is direct database access, which is a worse answer — it means the 2FA is
 * really "2FA plus a psql session".
 *
 * Design choices, each of which is a deliberate trade:
 *
 *   Ten codes, generated together. Fewer is annoying, more is a bigger surface
 *   with no benefit.
 *
 *   Shown ONCE, at generation. Only hashes are stored, so they cannot be shown
 *   again — the UI has to say so before the author navigates away, and the
 *   regeneration path has to be obvious.
 *
 *   Single use, marked in the same UPDATE that validates them. Same reasoning
 *   as login_challenges: a read-then-write lets two concurrent uses of the
 *   same code both succeed, and "single use" is the only thing that limits the
 *   damage if a code is photographed.
 *
 *   Hashed with the SAME scheme as passwords (scrypt), not SHA-256. A code is
 *   10 characters of base32 — about 50 bits — which is small enough that a
 *   fast hash is worth attacking offline if the table leaks. scrypt at 64 MiB
 *   per guess makes ten leaked hashes worthless.
 *
 *   Compared in constant time, and verification runs over ALL unused codes
 *   rather than stopping at the first match. Stopping early leaks, through
 *   timing, the position of the matching code in the list — which is a small
 *   leak, but it costs nothing to avoid.
 *
 * The cost is that verifying a backup code takes up to ten scrypt calls
 * (~200ms each at our parameters, so ~2 seconds). That is acceptable once, on
 * a recovery path, and it is why this is not on the normal sign-in path.
 * Verification short-circuits over codes that were already used, so the
 * common case — the first code, still unused — is one call.
 */

import { randomBytes } from "node:crypto";
import { hashPassword, verifyPassword } from "./password";
import { query, queryMany } from "../db";

/** Unambiguous alphabet: no 0/O/1/I/L, so a code can be read off paper. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 10;
const CODE_COUNT = 10;

/** `XXXXX-XXXXX`, which is easier to transcribe than an unbroken run. */
function formatCode(raw) {
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

/** Normalise whatever the author typed: case, dashes, spaces. */
function normalizeCode(input) {
  return String(input ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function generateRawCode() {
  const bytes = randomBytes(CODE_LENGTH);
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    // Modulo bias: 256 % 31 = 8, so the first 8 symbols are very slightly more
    // likely. Over a 50-bit space that is not a meaningful weakness, and
    // rejection sampling would complicate the loop for no practical gain.
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

/**
 * Generate a fresh set, replacing any existing unused codes.
 *
 * Returns the PLAINTEXT codes — the only time they exist. The caller must
 * display them and must not store them.
 *
 * Replacement rather than addition: "regenerate" should not silently leave ten
 * old codes live. Used codes are kept (they are a record that a recovery
 * happened, and `used_at` is the audit trail); unused ones are deleted.
 *
 * Hashes are computed in parallel — ten sequential scrypt calls at 64 MiB each
 * would be two seconds of blocking on a UI action.
 */
export async function generateBackupCodes(userId, { count = CODE_COUNT } = {}) {
  const raw = Array.from({ length: count }, generateRawCode);
  const hashes = await Promise.all(raw.map((code) => hashPassword(code)));

  await query(`DELETE FROM totp_backup_codes WHERE user_id = $1 AND used_at IS NULL`, [
    userId,
  ]);

  for (const hash of hashes) {
    await query(`INSERT INTO totp_backup_codes (user_id, code_hash) VALUES ($1, $2)`, [
      userId,
      hash,
    ]);
  }

  return raw.map(formatCode);
}

/**
 * Verify and burn a backup code.
 *
 * Returns true when the code was valid AND is now spent.
 *
 * The burn is guarded by `used_at IS NULL` in the UPDATE and the update is
 * conditional on the row id, so two concurrent submissions of the same code
 * cannot both return true — the second finds `used_at` already set and the
 * UPDATE affects no rows.
 */
export async function consumeBackupCode(userId, input) {
  const code = normalizeCode(input);
  if (code.length !== CODE_LENGTH) return false;

  const rows = await queryMany(
    `SELECT id, code_hash FROM totp_backup_codes
      WHERE user_id = $1 AND used_at IS NULL
      ORDER BY created_at`,
    [userId]
  );
  if (rows.length === 0) return false;

  let matchedId = null;

  // Every unused code is tested, even after a match, so the response time does
  // not reveal how far down the list the match was.
  for (const row of rows) {
    const ok = await verifyPassword(code, row.code_hash);
    if (ok && matchedId === null) matchedId = row.id;
  }

  if (matchedId === null) return false;

  const { rowCount } = await query(
    `UPDATE totp_backup_codes SET used_at = now()
      WHERE id = $1 AND used_at IS NULL`,
    [matchedId]
  );
  return rowCount === 1;
}

/** How many are left, for the security settings screen. */
export async function countUnusedBackupCodes(userId) {
  const rows = await queryMany(
    `SELECT count(*)::int AS n FROM totp_backup_codes
      WHERE user_id = $1 AND used_at IS NULL`,
    [userId]
  );
  return rows[0]?.n ?? 0;
}
