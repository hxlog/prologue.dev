/**
 * The account: exactly one, bootstrapped from the environment.
 *
 * There is no sign-up. The single author is created by `scripts/admin/bootstrap.mjs`
 * with a password the operator types, and every other path that could create a
 * user does not exist. That is the security model, and it is worth being
 * explicit about why it is a good one here: every attack that targets
 * registration, email verification, password reset, OAuth callback confusion,
 * or account enumeration simply has no surface.
 *
 * The `OWNER_EMAIL` check is not decorative. It is the one place that decides
 * who may sign in, read at request time rather than captured at import, so
 * changing the environment variable changes the answer without a code change.
 * If it is unset, nothing can sign in — failing closed, because the alternative
 * (failing open) would let the first arriving email become the owner.
 */

import { query, queryOne } from "../db";
import { hashPassword, needsRehash, verifyPassword } from "./password";

/** The configured owner, lowercased, or null when unset. */
export function ownerEmail() {
  const raw = process.env.OWNER_EMAIL;
  const email = String(raw ?? "").trim().toLowerCase();
  return email || null;
}

/**
 * Is this the configured owner?
 *
 * Compared as plain strings after normalisation, not in constant time. That is
 * correct here: the email is not a secret — it is in the site footer and in
 * every commit — so there is nothing to learn from its timing. What matters is
 * that an unrecognised address cannot proceed, not that the comparison is
 * opaque.
 */
export function isOwner(email) {
  const owner = ownerEmail();
  if (!owner) return false;
  return String(email ?? "").trim().toLowerCase() === owner;
}

/** Look up a user by email. Returns null for anything that is not the owner. */
export async function findUserByEmail(email) {
  if (!isOwner(email)) return null;

  return queryOne(
    `SELECT id, email, name, password_hash, totp_enabled, totp_secret,
            totp_last_step, totp_verified_at
       FROM users
      WHERE email = $1`,
    [String(email).trim().toLowerCase()]
  );
}

/** The owner row, by id. Used by /studio and the security settings screen. */
export async function findUserById(id) {
  return queryOne(
    `SELECT id, email, name, totp_enabled, totp_verified_at
       FROM users
      WHERE id = $1`,
    [id]
  );
}

/**
 * Verify a password, and upgrade the stored hash if our parameters have moved.
 *
 * Returns the user row on success and null on failure — including for an
 * unknown email, so the caller cannot accidentally branch on "no such user"
 * and leak which addresses exist. The hash comparison runs even then, against
 * a dummy, so the response time does not distinguish the two cases either:
 * without that, "unknown email" returns in microseconds while "wrong password"
 * takes 200ms, which is a perfectly usable oracle.
 *
 * The rehash is fire-and-forget by design. It is not worth failing a correct
 * login over, and `needsRehash` is cheap. The write goes through the pool, so
 * an unawaited promise here is only a lost update at worst — and the next
 * successful login does it again.
 */
export async function verifyCredentials(email, password) {
  const user = await findUserByEmail(email);

  if (!user) {
    // Spend roughly the same time as a real verification would, against a
    // hash of a random value that nothing can match.
    await verifyPassword(password, await dummyHash());
    return null;
  }

  // The lookup is memcmp'd against the owner before any hashing, so an
  // unrecognised address never reaches scrypt — and that is a problem, because
  // it makes "unknown email" measurably faster than "wrong password" for
  // anyone comparing response times. The dummy verification below restores the
  // symmetry by paying the same cost.

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return null;

  if (needsRehash(user.password_hash)) {
    hashPassword(password)
      .then((hash) =>
        query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [user.id, hash])
      )
      .catch((err) => console.error("[auth] rehash failed:", err.message));
  }

  return user;
}

/**
 * A valid-format hash of a value no one can supply, used to equalise timing on
 * the unknown-email path.
 *
 * Generated lazily and awaited, not computed at module load into a variable.
 * The eager version has a real bug: between the module being imported and the
 * promise resolving, the variable is still null, so the first sign-in attempt
 * after a cold start takes the fast path and leaks exactly the timing signal
 * this exists to hide — and it would leak on every cold start, which for a
 * serverless deployment is every deploy and every scale-up.
 *
 * Cached as a promise rather than a value so concurrent callers share one
 * computation instead of racing to produce several.
 */
let dummyHashPromise = null;
function dummyHash() {
  if (!dummyHashPromise) {
    dummyHashPromise = hashPassword("no-user-has-this-password");
  }
  return dummyHashPromise;
}

/** Set a new password. Caller is responsible for invalidating sessions. */
export async function setPassword(userId, password) {
  const hash = await hashPassword(password);
  await query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [userId, hash]);
}

export async function updateName(userId, name) {
  await query(`UPDATE users SET name = $2 WHERE id = $1`, [userId, name]);
}

export { hashPassword };
