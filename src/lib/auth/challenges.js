/**
 * Login challenges: the second factor of a two-phase sign-in.
 *
 * The problem this solves. With TOTP enabled, a correct password is necessary
 * but not sufficient. The two phases — "password accepted" and "code accepted"
 * — have to be tied together, and they must NOT be tied by "the password was
 * correct, so trust the next request from this browser". That would make the
 * second factor optional: anyone who knew the password could simply skip the
 * code step. So a correct password buys a challenge, and only the challenge
 * (plus a valid code) buys a session.
 *
 * Three properties, each of which is load-bearing:
 *
 *   Single use. `consumeChallenge` does
 *     UPDATE ... SET consumed_at = now() WHERE token_hash = $1 AND consumed_at IS NULL
 *     RETURNING user_id
 *   and treats "no row returned" as failure. Two concurrent redemptions of the
 *   same token therefore cannot both succeed — PostgreSQL serialises them on
 *   the row, and the second finds consumed_at already set. A read-then-write
 *   would have a window where both callers see NULL.
 *
 *   Attempt-bounded. `attempts` increments on every wrong code. Without it,
 *   someone who already has the password could create one challenge and then
 *   brute-force the 6-digit space (a million candidates) at leisure — and the
 *   login throttle in throttle.js would not notice, because that counts
 *   PASSWORD failures. Five attempts against a 30-second code is the whole
 *   search space that matters.
 *
 *   Short-lived. Five minutes. Long enough to switch to an authenticator app,
 *   short enough that a challenge left in a browser's session storage is inert.
 */

import { createHash, randomBytes } from "node:crypto";
import { query, queryOne } from "../db";

/** Five minutes, in ms. */
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

/**
 * Wrong codes allowed against ONE challenge.
 *
 * Five, not three. The failure mode of a low limit is that a user who
 * mistypes — or whose phone clock is 45 seconds off, so the code they are
 * looking at is the previous one — gets a fresh challenge and tries again,
 * which costs nothing but a round trip. The failure mode of a high limit is
 * a brute-force window. Five is comfortably inside "not brute-forceable"
 * (5 in 10^6 per challenge, and challenges are rate-limited by the password
 * phase which is itself throttled) while not annoying anyone.
 */
const MAX_ATTEMPTS = 5;

function hashToken(token) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Issue a challenge after a correct password.
 *
 * Returns the RAW token, which is the only time it exists — only its hash is
 * stored. The caller puts it in a short-lived cookie; it is never returned to
 * JavaScript in the page and never logged.
 *
 * Expired rows for this user are cleared first. There is no TTL job, so the
 * cheapest correct place to garbage-collect is here: the only way to create a
 * challenge is to have just passed the password check, so this runs at most
 * once per sign-in attempt and never in a hot path.
 */
export async function createChallenge({ userId, userAgent, ip }) {
  await query(`DELETE FROM login_challenges WHERE user_id = $1 AND expires_at <= now()`, [
    userId,
  ]);

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);

  await query(
    `INSERT INTO login_challenges (user_id, token_hash, expires_at, user_agent, ip)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, hashToken(token), expiresAt, userAgent ?? null, ip ?? null]
  );

  return { token, expiresAt };
}

/**
 * Read a challenge without consuming it, to decide whether to show the code
 * form and how many attempts are left.
 *
 * Returns null when the token is unknown, expired, or already consumed — the
 * caller turns all three into "start over", deliberately without distinguishing
 * them, because telling someone which of the three applied to a token they
 * hold is telling them something they already know.
 */
export async function peekChallenge(token) {
  if (!token) return null;

  const row = await queryOne(
    `SELECT c.id, c.user_id, c.attempts, c.expires_at, u.email, u.totp_enabled
       FROM login_challenges c
       JOIN users u ON u.id = c.user_id
      WHERE c.token_hash = $1
        AND c.consumed_at IS NULL
        AND c.expires_at > now()`,
    [hashToken(token)]
  );
  if (!row) return null;

  return {
    id: row.id,
    userId: row.user_id,
    email: row.email,
    totpEnabled: row.totp_enabled === true,
    attempts: row.attempts,
    attemptsRemaining: Math.max(0, MAX_ATTEMPTS - row.attempts),
    expired: false,
  };
}

/**
 * Spend one attempt. Returns the remaining count, or 0 when the challenge is
 * now burned.
 *
 * Separate from `consumeChallenge` so a wrong code can be counted without
 * consuming, which is the point: the challenge has to survive a typo.
 *
 * At the limit the challenge is consumed outright rather than left to expire.
 * That is deliberate — it forces a fresh password check, which is throttled,
 * so brute-forcing codes costs an attacker the password throttle too.
 */
export async function recordChallengeAttempt(token) {
  const row = await queryOne(
    `UPDATE login_challenges
        SET attempts = attempts + 1,
            consumed_at = CASE WHEN attempts + 1 >= $2 THEN now() ELSE consumed_at END
      WHERE token_hash = $1
        AND consumed_at IS NULL
        AND expires_at > now()
      RETURNING attempts`,
    [hashToken(token), MAX_ATTEMPTS]
  );

  if (!row) return { remaining: 0, burned: true };
  return {
    remaining: Math.max(0, MAX_ATTEMPTS - row.attempts),
    burned: row.attempts >= MAX_ATTEMPTS,
  };
}

/**
 * Redeem a challenge, returning the user id exactly once.
 *
 * The `AND consumed_at IS NULL` predicate plus RETURNING is what makes this
 * single-use under concurrency — see the file header. Returns null when the
 * token is unknown, expired, or already spent.
 *
 * Called only after the TOTP code has verified, so a failure here means
 * "someone else got there first", which the caller reports as a generic
 * sign-in failure rather than something specific.
 */
export async function consumeChallenge(token) {
  if (!token) return null;

  const row = await queryOne(
    `UPDATE login_challenges
        SET consumed_at = now()
      WHERE token_hash = $1
        AND consumed_at IS NULL
        AND expires_at > now()
      RETURNING user_id`,
    [hashToken(token)]
  );

  return row ? { userId: row.user_id } : null;
}

/** Drop a challenge the user abandoned (closed the tab, hit "cancel"). */
export async function abandonChallenge(token) {
  if (!token) return;
  await query(`DELETE FROM login_challenges WHERE token_hash = $1`, [hashToken(token)]);
}

/** Housekeeping, for the same opportunistic reason as pruneExpiredSessions. */
export async function pruneExpiredChallenges() {
  const { rowCount } = await query(`DELETE FROM login_challenges WHERE expires_at <= now()`);
  return rowCount;
}

export const CHALLENGE_COOKIE_NAME =
  process.env.NODE_ENV === "production" && process.env.PROLOGUE_ALLOW_INSECURE_COOKIE !== "1"
    ? "__Host-prologue_challenge"
    : "prologue_challenge";

export const CHALLENGE_TTL_SECONDS = CHALLENGE_TTL_MS / 1000;
export const CHALLENGE_MAX_ATTEMPTS = MAX_ATTEMPTS;
