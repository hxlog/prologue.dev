/**
 * TOTP enrollment: turning the second factor on and off.
 *
 * Enabling is a two-step handshake, and the ordering is the whole design:
 *
 *   1. `beginTotpEnrollment` generates a secret and stores it in
 *      `totp_secret` while leaving `totp_enabled` false. The account is
 *      unchanged — sign-in still asks for only a password — because nothing
 *      has proven the author can generate a code yet.
 *
 *   2. `confirmTotpEnrollment` verifies a code from that secret. Only then
 *      does `totp_enabled` become true.
 *
 * Doing it the other way round — enable, then show the secret — locks the
 * author out the moment they close the tab before scanning, or scan with a
 * phone whose clock is wrong. This ordering cannot lock anyone out: an
 * abandoned enrollment leaves a secret in the column and the flag false, which
 * is inert.
 *
 * Disabling requires the same proof as enabling plus the account password.
 * Without the password, anyone who found an unlocked browser could remove the
 * second factor and then keep the account permanently — the one action that
 * should not be possible from a borrowed session.
 */

import { query } from "../db";
import { verifyPassword } from "./password";
import { generateTotpSecret, totpUri, verifyTotp } from "./totp";
import { destroyAllSessions } from "./session-store";
import { generateBackupCodes } from "./backup-codes";

/**
 * Step 1: generate a secret and return it with its provisioning URI.
 *
 * The secret is stored immediately, unconfirmed. Re-running this before
 * confirming replaces it, which is what should happen if the author
 * accidentally closes the QR code — they get a new one rather than being stuck
 * with a secret they never scanned.
 *
 * Returns null when TOTP is already enabled: re-enrolling a working second
 * factor is a foot-gun, and the disable path exists for deliberately changing
 * devices.
 */
export async function beginTotpEnrollment(user) {
  const row = await query(
    `SELECT totp_enabled FROM users WHERE id = $1`,
    [user.id]
  );
  if (row.rows[0]?.totp_enabled) return null;

  const secret = generateTotpSecret();
  await query(`UPDATE users SET totp_secret = $2 WHERE id = $1`, [user.id, secret]);

  return {
    secret,
    uri: totpUri({
      secret,
      account: user.email,
      issuer: "Prologue",
    }),
    // The secret is shown in groups so it can be typed into an app that cannot
    // scan — a real fallback, and the reason the raw value is returned as well
    // as the URI.
    formatted: secret.match(/.{1,4}/g).join(" "),
  };
}

/**
 * Step 2: confirm with a code, which enables the factor and issues backup
 * codes.
 *
 * Returns `{ ok: false, reason }` rather than throwing, because every failure
 * here is an expected outcome of a human typing six digits.
 *
 * The re-check of `totp_enabled` matters: this is called from a server action,
 * and two rapid submissions of the confirm form would otherwise both pass
 * verification, both enable, and both generate a backup-code set — the second
 * silently invalidating the first set the author had just written down.
 */
export async function confirmTotpEnrollment(user, code) {
  const row = await query(
    `SELECT totp_secret, totp_enabled FROM users WHERE id = $1`,
    [user.id]
  );
  const current = row.rows[0];
  if (!current?.totp_secret) return { ok: false, reason: "not_started" };
  if (current.totp_enabled) return { ok: false, reason: "already_enabled" };

  const result = verifyTotp(code, current.totp_secret, { window: 1 });
  if (!result.ok) return { ok: false, reason: "bad_code" };

  // `totp_enabled = false` in the predicate, so a concurrent confirm cannot
  // double-apply even if both got past the SELECT above.
  const updated = await query(
    `UPDATE users
        SET totp_enabled = true,
            totp_verified_at = now(),
            totp_last_step = $2
      WHERE id = $1 AND totp_enabled = false`,
    [user.id, result.step]
  );
  if (updated.rowCount !== 1) return { ok: false, reason: "already_enabled" };

  const backupCodes = await generateBackupCodes(user.id);

  // A second factor that only exists on one device is a single point of
  // failure; signing other browsers out means the author is forced to prove
  // the new factor works before they rely on it. The current session survives,
  // or enabling 2FA would log them out of the page they are standing on.
  await destroyAllSessions(user.id, { exceptSessionId: user.sessionId });

  return { ok: true, backupCodes };
}

/**
 * Verify a submitted code against the enabled secret, with replay protection.
 *
 * This is the sign-in path. `totp_last_step` is the highest step ever accepted
 * for this account, and a code at or below it is refused (RFC 6238 section
 * 5.2). Without that, a code seen over a shoulder stays valid for the rest of
 * its 30-second window and the one after it, because the ±1 window that
 * absorbs clock skew also accepts codes already spent.
 *
 * The claim is a conditional UPDATE rather than a read-then-write: two
 * simultaneous submissions of the same code would both pass a SELECT, and only
 * one should get in.
 */
export async function claimTotpCode(userId, code) {
  const row = await query(
    `SELECT totp_secret, totp_last_step FROM users
      WHERE id = $1 AND totp_enabled = true`,
    [userId]
  );
  const user = row.rows[0];
  if (!user?.totp_secret) return { ok: false, reason: "not_enabled" };

  const result = verifyTotp(code, user.totp_secret, { window: 1 });
  if (!result.ok) return { ok: false, reason: "bad_code" };

  const claimed = await query(
    `UPDATE users
        SET totp_last_step = $2
      WHERE id = $1
        AND (totp_last_step IS NULL OR totp_last_step < $2)`,
    [userId, result.step]
  );

  if (claimed.rowCount !== 1) {
    return { ok: false, reason: "replayed" };
  }
  return { ok: true };
}

/**
 * Turn the second factor off.
 *
 * Requires the account password as well as a valid code — see the file header.
 * A backup code is accepted in place of the TOTP code, because the situation
 * where someone needs to disable 2FA is often the situation where their
 * authenticator is gone.
 */
export async function disableTotp(user, { password, code, backupCode }) {
  const row = await query(`SELECT password_hash FROM users WHERE id = $1`, [user.id]);
  const passwordOk = await verifyPassword(password, row.rows[0]?.password_hash);
  if (!passwordOk) return { ok: false, reason: "bad_password" };

  const { consumeBackupCode } = await import("./backup-codes");

  let verified = false;
  if (backupCode) {
    verified = await consumeBackupCode(user.id, backupCode);
  } else if (code) {
    const result = await claimTotpCode(user.id, code);
    verified = result.ok;
  }
  if (!verified) return { ok: false, reason: "bad_code" };

  await query(
    `UPDATE users
        SET totp_enabled = false,
            totp_secret = NULL,
            totp_verified_at = NULL,
            totp_last_step = NULL
      WHERE id = $1`,
    [user.id]
  );
  await query(`DELETE FROM totp_backup_codes WHERE user_id = $1`, [user.id]);

  // Every other browser is signed out: the factor they were authenticated
  // against no longer exists, so their sessions are no longer meaningfully
  // protected. Losing a factor should not leave the doors it was guarding open.
  await destroyAllSessions(user.id, { exceptSessionId: user.sessionId });

  return { ok: true };
}

/** What the settings screen needs to render its current state. */
export async function getTotpState(userId) {
  const row = await query(
    `SELECT totp_enabled, totp_verified_at,
            (SELECT count(*)::int FROM totp_backup_codes
              WHERE user_id = $1 AND used_at IS NULL) AS unused_codes
       FROM users WHERE id = $1`,
    [userId]
  );
  const state = row.rows[0];
  if (!state) return null;

  return {
    enabled: state.totp_enabled === true,
    verifiedAt: state.totp_verified_at,
    unusedBackupCodes: state.unused_codes,
  };
}
