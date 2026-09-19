/**
 * TOTP (RFC 6238) and its provisioning URI (the de-facto "otpauth://" format
 * every authenticator app understands).
 *
 * Hand-written rather than pulled in, because the whole thing is HMAC-SHA1 over
 * a counter: ~60 lines using `node:crypto`, versus a dependency on the sign-in
 * path. The two parts that are easy to get subtly wrong are called out where
 * they occur.
 *
 * Parameters: SHA-1, 6 digits, 30-second step. Those are the defaults every
 * authenticator app assumes when a QR code does not say otherwise, and RFC 6238
 * requires SHA-1 support from any conforming implementation. HMAC-SHA1 is not a
 * weakness here — it is a PRF, and the collision attacks on SHA-1 do not touch
 * the security property TOTP relies on.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const DIGITS = 6;
const STEP_SECONDS = 30;
const SECRET_BYTES = 20; // 160 bits, the RFC 4226 §4 recommendation for SHA-1

// RFC 4648 base32, no padding. Authenticator apps decode this; `base64url`
// would be shorter but is not what the otpauth format means by `secret`.
const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * A new secret.
 *
 * 20 random bytes, base32-encoded, which is what `openssl rand -base32 20`
 * produces and what every other implementation expects.
 */
export function generateTotpSecret() {
  return base32Encode(randomBytes(SECRET_BYTES));
}

/**
 * The 6-digit code for a counter value.
 *
 * The dynamic-truncation step is the part worth reading twice: the low four
 * bits of the LAST byte select a 4-byte window, and that window is read as a
 * big-endian uint32 with the top bit masked off. Getting the mask wrong yields
 * negative numbers and a code with a minus sign in it; getting the `+ 1` offset
 * wrong reads the wrong window.
 */
function hotp(key, counter) {
  const buffer = Buffer.alloc(8);
  // Big-endian 64-bit counter. writeBigUInt64BE, not a pair of 32-bit writes:
  // a JS number cannot hold the full range and the shift maths is easy to
  // get wrong in a way that only shows up in 2038.
  buffer.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac("sha1", key).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];

  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

/** The counter for an instant. Steps are 30s, counted from the Unix epoch. */
export function currentStep(atMs = Date.now()) {
  return Math.floor(atMs / 1000 / STEP_SECONDS);
}

/**
 * Verify a submitted code.
 *
 * Returns `{ ok, step }` on success and `{ ok: false }` otherwise. The caller
 * needs `step`, not just a boolean: RFC 6238 §5.2 says a code must not be
 * accepted twice, and the only way to enforce that is to remember the highest
 * step already used and reject anything at or below it. Without that, a code
 * observed over someone's shoulder stays valid for the rest of its window.
 *
 * WINDOW = 1 accepts the previous step, the current one, and the next. That
 * covers clock skew in both directions and costs nothing: an attacker cannot
 * usefully exploit a 90-second window that they already needed to be within
 * 90 seconds for.
 *
 * The comparison is `timingSafeEqual`, and the submitted value is checked for
 * shape first so a non-numeric input cannot make the comparison throw.
 */
export function verifyTotp(submitted, secret, { window = 1, atMs = Date.now() } = {}) {
  const code = String(submitted ?? "").trim().replace(/\s+/g, "");
  if (!/^\d{6}$/.test(code)) return { ok: false };

  const key = base32Decode(secret);
  if (!key) return { ok: false };

  const step = currentStep(atMs);
  const submittedBuffer = Buffer.from(code, "utf8");

  for (let offset = -window; offset <= window; offset++) {
    const candidate = Buffer.from(hotp(key, step + offset), "utf8");
    if (
      candidate.length === submittedBuffer.length &&
      timingSafeEqual(candidate, submittedBuffer)
    ) {
      return { ok: true, step: step + offset };
    }
  }

  return { ok: false };
}

/**
 * The otpauth:// URI behind the QR code.
 *
 * `issuer` appears twice on purpose: as a prefix in the label, which is what
 * older apps read, and as its own parameter, which is what the Key URI Format
 * specifies. Apps disagree about which they honour and some show a bare
 * username when only one is present.
 */
export function totpUri({ secret, account, issuer }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// base32 (RFC 4648, no padding)
// ---------------------------------------------------------------------------

export function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += B32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

/**
 * Decode base32, tolerating the shapes users paste.
 *
 * Authenticator apps and `otpauth://` URIs disagree about case and about
 * padding, and people paste secrets with spaces in them. Lowercasing,
 * stripping whitespace and dropping trailing `=` covers every variant seen in
 * practice. Returns null on an invalid character rather than decoding around
 * it — silently skipping a character would produce a secret that generates
 * plausible-looking wrong codes, which is the worst possible failure mode here.
 */
export function base32Decode(input) {
  const clean = String(input ?? "")
    .toUpperCase()
    .replace(/[\s=]/g, "");
  if (clean.length === 0) return null;

  let bits = 0;
  let value = 0;
  const output = [];

  for (const char of clean) {
    const index = B32_ALPHABET.indexOf(char);
    if (index === -1) return null;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(output);
}
