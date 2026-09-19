/**
 * Login throttling.
 *
 * The threat this addresses is not a distributed password-cracking campaign
 * against a public sign-up form — there is one account and no sign-up. It is
 * someone who knows the email address guessing passwords, and the reason the
 * throttle is per-account rather than per-IP is that an attacker with a handful
 * of addresses defeats any per-IP limit while the honest user is unaffected by
 * a per-account one.
 *
 * Keys are hashed with SHA-256 before storage, both for the account key (over
 * the email) and the IP. `login_attempts.key_hash` is the primary key, so the
 * table is bounded by the number of distinct keys that have ever attempted a
 * login, and nothing in it is a plaintext address.
 *
 * Two counters, checked against two limits:
 *
 *   key  = sha256("acct:" + email)          — the slow limit, on the ACCOUNT
 *   key  = sha256("ip:" + clientIp)         — the fast limit, on the SOURCE
 *
 * An attacker guessing one account's password hits the account limit and is
 * locked out. An attacker enumerating many accounts from one host hits the IP
 * limit. Neither limit alone covers both.
 */

import { createHash } from "node:crypto";
import { query, queryMany, queryOne } from "../db";

/**
 * The ladder: lock duration indexed by how many failures have accumulated, so
 * index 0 is "no failures" and index N is "N failures".
 *
 * Five frees before anything locks, and the durations after that are short
 * enough that a fat-fingered evening resolves itself without intervention,
 * while a real guesser gets ~6 attempts per hour.
 *
 * The first entry must be 0 and index 1..FREE_ATTEMPTS must be 0 too; the
 * consistent arithmetic is what makes `attemptsRemaining` and the lock check
 * agree. A ladder whose free attempts and its reported remaining count are
 * derived separately is how "3 attempts left" ends up followed by a lockout on
 * the next try — the count says one thing and the index says another.
 */
const FREE_ATTEMPTS = 5;

const ACCOUNT_LADDER_MS = [
  0, // 0 failures
  0, // 1
  0, // 2
  0, // 3
  0, // 4
  60_000, // 5  — one minute
  5 * 60_000, // 6  — five minutes
  15 * 60_000, // 7  — fifteen minutes
  60 * 60_000, // 8+ — an hour
];

/**
 * The IP limit: a coarse backstop, deliberately MORE lenient than the account
 * ladder, because on this site it is nearly redundant.
 *
 * Worth being honest about what it does and does not buy. The classic reason
 * for an IP limit is stopping enumeration across many accounts — but there is
 * exactly ONE account here, so there is nothing to enumerate. The account key
 * already accumulates every failure on that account regardless of source, and
 * a successful login is the only thing that clears it, which only the author
 * can produce.
 *
 * What the IP key still does: cap how much scrypt work one host can make the
 * server do. Without it, a single attacker could sit on the account ladder's
 * one-hour rung forever — that is ~120 password attempts a day, from one IP,
 * with no further cost to them. Twenty free attempts before this fires means a
 * legitimate burst (a new keyboard, a shared password manager) never reaches
 * it, while a scripted source does.
 *
 * The ordering matters and got this wrong on the first pass: at 3 free
 * attempts this fired BEFORE the account ladder, so the author's own IP
 * counter locked them out after three typos — punishing the only user for a
 * key that exists to inconvenience someone who cannot log in anyway.
 */
const IP_LADDER_MS = [
  0, // 0
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 1-10
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 11-20
  10 * 60_000, // 21  — ten minutes
  60 * 60_000, // 22+ — an hour
];

/**
 * Failures older than this do not count.
 *
 * Without a window, the ladder would count every failure forever, so one
 * fat-fingered evening a year ago would still be contributing to today's
 * lockout. The window is longer than any lockout step, so an attacker cannot
 * simply wait it out between guesses.
 */
const WINDOW_MS = 24 * 60 * 60 * 1000;

function hashKey(kind, value) {
  return createHash("sha256").update(`${kind}:${String(value).toLowerCase()}`, "utf8").digest("hex");
}

/**
 * Is this attempt allowed?
 *
 * Returns `{ ok: true }` or `{ ok: false, retryAfterSeconds }`. Called BEFORE
 * the password is verified, so a locked key never reaches the password hash:
 * that is what turns the throttle into a real defence rather than a report,
 * since the scrypt call is the expensive part an attacker would otherwise be
 * making us do.
 *
 * `now()` comes from the database in the UPDATE below but from Node here; both
 * are read on the same host in this deployment, and the comparison is between
 * two values written by the same process, so drift between them is not a
 * correctness risk — it would only shift a lockout by the drift.
 */
export async function checkThrottle({ email, ip }) {
  const keys = [hashKey("acct", email), ip ? hashKey("ip", ip) : null].filter(Boolean);
  const now = Date.now();

  const rows = await queryMany(
    `SELECT key_hash, failures, first_at, locked_until
       FROM login_attempts
      WHERE key_hash = ANY($1::text[])`,
    [keys]
  );

  let longest = 0;
  for (const row of rows) {
    // A window that has passed resets the count rather than expiring the row.
    const withinWindow = now - new Date(row.first_at).getTime() < WINDOW_MS;
    if (!withinWindow) continue;

    if (row.locked_until) {
      const remaining = new Date(row.locked_until).getTime() - now;
      if (remaining > 0) longest = Math.max(longest, remaining);
    }
  }

  if (longest > 0) {
    return { ok: false, retryAfterSeconds: Math.ceil(longest / 1000) };
  }
  return { ok: true };
}

/**
 * Record a failed attempt and return the resulting lockout, if any.
 *
 * Both counters are incremented in one transaction so a crash between them
 * cannot leave the account counter ahead of the IP one.
 *
 * The upsert has to handle three cases in one statement: a fresh key, a key
 * whose window has expired (reset to 1), and a live key (increment). Doing it
 * as `INSERT ... ON CONFLICT DO UPDATE` with a CASE keeps it atomic without a
 * read-then-write race between two simultaneous login attempts.
 */
export async function recordFailure({ email, ip }) {
  const entries = [
    ["acct", email, ACCOUNT_LADDER_MS],
    ["ip", ip, IP_LADDER_MS],
  ].filter(([, value]) => value);

  let longestLockSeconds = 0;

  for (const [kind, value, ladder] of entries) {
    const key = hashKey(kind, value);

    const row = await queryOne(
      `INSERT INTO login_attempts (key_hash, failures, first_at, locked_until)
       VALUES ($1, 1, now(), NULL)
       ON CONFLICT (key_hash) DO UPDATE
         SET failures = CASE
               WHEN login_attempts.first_at < now() - $2::interval THEN 1
               ELSE login_attempts.failures + 1
             END,
             first_at = CASE
               WHEN login_attempts.first_at < now() - $2::interval THEN now()
               ELSE login_attempts.first_at
             END,
             locked_until = NULL
       RETURNING failures`,
      [key, `${WINDOW_MS} milliseconds`]
    );

    const failures = row?.failures ?? 1;
    const lockMs = ladder[Math.min(failures, ladder.length - 1)];

    if (lockMs > 0) {
      await query(
        `UPDATE login_attempts
            SET locked_until = now() + $2::interval
          WHERE key_hash = $1`,
        [key, `${lockMs} milliseconds`]
      );
      longestLockSeconds = Math.max(longestLockSeconds, Math.ceil(lockMs / 1000));
    }
  }

  return { lockedForSeconds: longestLockSeconds };
}

/**
 * Clear the counters after a successful sign-in.
 *
 * Both keys, not just the account one, and the reason is specific to this
 * deployment rather than a general rule.
 *
 * On a multi-tenant site, clearing the IP counter on any success would be
 * wrong: one user signing in would erase the evidence of another user's failed
 * attempts from the same shared address. Here there is exactly ONE account, so
 * a successful sign-in is proof that the client is the author — nobody else can
 * produce one. The IP key exists only to slow down enumeration of an account
 * list with one entry, and the author is the only party a success can benefit.
 *
 * Clearing only the account key produces a genuinely bad failure: the author
 * mistypes their password six times, then gets it right, and is still locked
 * out for thirty minutes by their own IP counter — having just proven who they
 * are.
 */
export async function clearFailures({ email, ip }) {
  const keys = [hashKey("acct", email), ip ? hashKey("ip", ip) : null].filter(Boolean);
  if (keys.length === 0) return;
  await query(`DELETE FROM login_attempts WHERE key_hash = ANY($1::text[])`, [keys]);
}

/**
 * How many attempts remain before a lockout, for the sign-in form's copy.
 *
 * Derived from the same ladders the enforcement uses, by finding the first
 * index whose duration is non-zero — so the number shown and the number acted
 * on cannot drift apart. Free attempts are counted from zero failures, which is
 * why this is `index - failures` rather than `FREE_ATTEMPTS - failures`: the
 * two are the same number only as long as the ladder's leading zeros match
 * FREE_ATTEMPTS, and deriving it means that stays true if either changes.
 */
export async function attemptsRemaining({ email, ip }) {
  const entries = [
    ["acct", email, ACCOUNT_LADDER_MS],
    ["ip", ip, IP_LADDER_MS],
  ].filter(([, value]) => value);

  const keys = entries.map(([kind, value]) => hashKey(kind, value));
  const rows = await queryMany(
    `SELECT key_hash, failures FROM login_attempts WHERE key_hash = ANY($1::text[])`,
    [keys]
  );

  const failuresByKey = new Map(rows.map((r) => [r.key_hash, r.failures]));

  let remaining = Infinity;
  for (const [kind, value, ladder] of entries) {
    const firstLock = ladder.findIndex((ms) => ms > 0);
    const limit = firstLock === -1 ? Infinity : firstLock;
    const failures = failuresByKey.get(hashKey(kind, value)) ?? 0;
    remaining = Math.min(remaining, Math.max(0, limit - failures));
  }

  return Number.isFinite(remaining) ? remaining : FREE_ATTEMPTS;
}
