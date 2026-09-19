/**
 * Sessions: the cookie half.
 *
 * The cookie carries a 256-bit random token; the database stores only its
 * SHA-256. That asymmetry is the whole design: a leaked database dump, a log
 * line, or a backup cannot be turned into a login, because the stored value is
 * not the credential — it is evidence that you once had it.
 *
 * No expiry secret, no JWT, no signing key. A random number compared against a
 * hash needs none of those, and none of them can be got wrong here.
 *
 * Everything that touches the `sessions` TABLE lives in session-store.js, with
 * no request dependency, so the modules that invalidate sessions (2FA
 * enrolment, password changes) do not transitively need `next/headers`. This
 * file is the part that reads and writes the cookie.
 */

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { queryOne, query } from "../db";
import { hashToken } from "./session-store";

/**
 * Cookie name.
 *
 * `__Host-` in production, which browsers only accept when the cookie is
 * Secure, has no Domain attribute, and has Path=/. Those constraints are what
 * stop a sibling subdomain — or anything that can set a cookie on one — from
 * overwriting this session. The prefix is dropped outside production because
 * `__Host-` cookies are silently discarded over http://localhost, which
 * produces a login that appears to succeed and then does not.
 */
const COOKIE_NAME =
  process.env.NODE_ENV === "production" && process.env.PROLOGUE_ALLOW_INSECURE_COOKIE !== "1"
    ? "__Host-prologue_session"
    : "prologue_session";

/** 30 days. Long enough that the author is not re-authenticating constantly. */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Refresh `expires_at` when a session is more than a day into its window.
 *
 * Without this, a session created 30 days ago expires mid-use even though the
 * author has been active the whole time. With a refresh on every single
 * request, every page view is a write. Daily is the middle: a long-lived
 * browser keeps working, and an active session costs one UPDATE per day.
 */
const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;

/** A new opaque token: 32 random bytes, base64url. */
function newToken() {
  return randomBytes(32).toString("base64url");
}

/**
 * Create a session and set the cookie.
 *
 * `cookies()` is async in Next 16 and can only be written from a Server Action
 * or a Route Handler — a Server Component render cannot set cookies. Callers
 * are sign-in / sign-out routes and actions, all of which satisfy that.
 */
export async function createSession({ userId, userAgent, ip }) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await query(
    `INSERT INTO sessions (user_id, token_hash, expires_at, user_agent, ip)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, hashToken(token), expiresAt, userAgent ?? null, ip ?? null]
  );

  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.PROLOGUE_ALLOW_INSECURE_COOKIE !== "1",
    path: "/",
    expires: expiresAt,
  });

  return { token, expiresAt };
}

/**
 * The signed-in user, or null.
 *
 * One query, with the user row joined in, so a session check is a single round
 * trip rather than two. Expiry is enforced in SQL, not in JS: `expires_at >
 * now()` uses the database's clock, so a server whose clock has drifted cannot
 * extend a session.
 *
 * The `last_used_at` / `expires_at` refresh is deliberately awaited rather than
 * fire-and-forget. In a serverless function an unawaited promise can be cut off
 * when the response is sent, so the write would work locally and silently stop
 * happening in production — a bug that only shows up as everyone being logged
 * out one day.
 */
export async function getSession() {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const row = await queryOne(
    `SELECT s.id AS session_id, s.expires_at, s.last_used_at,
            u.id, u.email, u.name, u.totp_enabled
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1
        AND s.expires_at > now()`,
    [hashToken(token)]
  );
  if (!row) return null;

  const now = Date.now();
  const sinceUse = now - new Date(row.last_used_at).getTime();
  if (sinceUse > REFRESH_AFTER_MS) {
    const expiresAt = new Date(now + SESSION_TTL_MS);
    await query(
      `UPDATE sessions SET last_used_at = now(), expires_at = $2 WHERE id = $1`,
      [row.session_id, expiresAt]
    );
  } else {
    await query(`UPDATE sessions SET last_used_at = now() WHERE id = $1`, [
      row.session_id,
    ]);
  }

  return {
    sessionId: row.session_id,
    user: {
      id: row.id,
      email: row.email,
      name: row.name,
      totpEnabled: row.totp_enabled === true,
    },
  };
}

/** Destroy the current session and clear the cookie. */
export async function destroySession() {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;

  if (token) {
    await query(`DELETE FROM sessions WHERE token_hash = $1`, [hashToken(token)]);
  }
  store.delete(COOKIE_NAME);
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
