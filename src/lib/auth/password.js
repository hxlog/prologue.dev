/**
 * Password hashing.
 *
 * scrypt, from Node's own `crypto` — no dependency, no native build, and the
 * parameters are stated in the stored hash rather than in a config file. That
 * last part matters more than it looks: `verifyPassword` reads N/r/p out of the
 * stored string, so raising the cost factor later does not invalidate existing
 * hashes. Old passwords keep verifying at their original cost and are rehashed
 * on the next successful login (`needsRehash`).
 *
 * Why not bcrypt/argon2: bcrypt needs a native addon and truncates at 72 bytes,
 * and argon2 needs a native addon. scrypt is the one memory-hard KDF that ships
 * in the standard library.
 *
 * The honest weakness, stated rather than glossed: scrypt here runs on the
 * event loop's thread pool, and each hash allocates ~64 MiB. That is fine for
 * one author logging in, and it is a denial-of-service vector if sign-in were
 * ever exposed to the public. It is not exposed: there is exactly one account,
 * the sign-in route is throttled (src/lib/auth/throttle.js), and the site is a
 * personal blog.
 */

import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

/**
 * Cost parameters.
 *
 * N = 2^16 (65536), r = 8, p = 1. Memory is 128 * N * r = 64 MiB, which is the
 * parameter that actually matters: it is what makes a GPU or ASIC attack
 * expensive. OWASP's floor for scrypt is N = 2^17 with r = 8, or the N = 2^16 /
 * p = 2 combination; this sits at the lower of those, deliberately, because the
 * serverless memory ceiling is real and the threat model is one account with a
 * long random password.
 */
const N = 65536;
const R = 8;
const P = 1;
const KEYLEN = 64;
const SALT_BYTES = 16;

/**
 * `maxmem` must be set explicitly, and this is the single most likely thing to
 * get wrong.
 *
 * Node's default `maxmem` is 32 MiB, and scrypt throws — not degrades, throws —
 * when `128 * N * r` exceeds it. At the defaults that would be 64 MiB against a
 * 32 MiB ceiling, so every hash attempt would fail with ERR_CRYPTO_INVALID_SCRYPT_PARAMS
 * at runtime, on the login path, where nothing tests it. 128 MiB gives the
 * 64 MiB working set room for the output buffer without being a number someone
 * raises to hide a problem.
 */
const MAXMEM = 128 * 1024 * 1024;

const PREFIX = "scrypt";

/**
 * Hash a password into a self-describing string:
 *
 *   scrypt$N=65536,r=8,p=1$<salt base64>$<key base64>
 *
 * Storing the parameters is what makes the format forward-compatible. A bare
 * `salt:hash` would silently lock out every existing password the first time
 * anyone tuned the cost.
 */
export async function hashPassword(password) {
  assertPassword(password);

  const salt = randomBytes(SALT_BYTES);
  const key = await scrypt(password.normalize("NFKC"), salt, KEYLEN, {
    N,
    r: R,
    p: P,
    maxmem: MAXMEM,
  });

  return [
    PREFIX,
    `N=${N},r=${R},p=${P}`,
    salt.toString("base64"),
    key.toString("base64"),
  ].join("$");
}

/**
 * Verify a password against a stored hash.
 *
 * Returns false for a malformed or unrecognised hash rather than throwing. A
 * corrupt row is a failed login, not a 500 — and a 500 on the sign-in route
 * tells an attacker they found something.
 */
export async function verifyPassword(password, stored) {
  if (typeof password !== "string" || !password) return false;
  if (typeof stored !== "string") return false;

  const parsed = parseHash(stored);
  if (!parsed) return false;

  let derived;
  try {
    derived = await scrypt(password.normalize("NFKC"), parsed.salt, parsed.key.length, {
      N: parsed.N,
      r: parsed.r,
      p: parsed.p,
      // A stored hash could name parameters that exceed our ceiling — a row
      // written by an older, more expensive build, say. Refusing is correct;
      // allocating 4 GiB because a database row asked for it is not.
      maxmem: MAXMEM,
    });
  } catch {
    return false;
  }

  // Lengths are equal by construction (keylen was parsed.key.length), but
  // timingSafeEqual throws on a mismatch rather than returning false, so the
  // guard stays.
  if (derived.length !== parsed.key.length) return false;
  return timingSafeEqual(derived, parsed.key);
}

/**
 * True when `stored` was produced with weaker parameters than the current ones.
 *
 * Call this after a successful verify and rehash if it returns true. Without it
 * the cost can never be raised: existing hashes would keep verifying at their
 * original cost forever, and the only way to upgrade would be to reset the
 * password.
 */
export function needsRehash(stored) {
  const parsed = parseHash(stored);
  if (!parsed) return true;
  return parsed.N < N || parsed.r < R || parsed.p < P;
}

/** Parse the stored format, or return null if it is not one we wrote. */
function parseHash(stored) {
  const parts = String(stored).split("$");
  if (parts.length !== 4 || parts[0] !== PREFIX) return null;

  const params = {};
  for (const pair of parts[1].split(",")) {
    const [key, value] = pair.split("=");
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) return null;
    params[key] = n;
  }
  if (!params.N || !params.r || !params.p) return null;

  // Bound p as well as N and r. p multiplies the CPU cost without multiplying
  // memory, so a hostile row could otherwise pin a core for a very long time
  // while staying under the maxmem check.
  if (params.N > N || params.r > R || params.p > P) return null;

  let salt;
  let key;
  try {
    salt = Buffer.from(parts[2], "base64");
    key = Buffer.from(parts[3], "base64");
  } catch {
    return null;
  }
  if (salt.length < 8 || key.length < 32) return null;

  return { N: params.N, r: params.r, p: params.p, salt, key };
}

function assertPassword(password) {
  if (typeof password !== "string" || password.length === 0) {
    throw new TypeError("Password must be a non-empty string");
  }
}
