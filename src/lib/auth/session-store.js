/**
 * Session storage: everything that touches the `sessions` table and nothing
 * that touches the request.
 *
 * Split out from sessions.js deliberately. The cookie layer needs
 * `next/headers`, which only exists inside a request — so as long as the
 * database operations lived in the same module, anything that invalidated a
 * session (enabling 2FA, changing a password, a future cron job pruning
 * expired rows) transitively depended on request-scoped APIs it has no use
 * for. That coupling is invisible until something calls it outside a request
 * and gets `Cannot find module 'next/headers'`, or worse, a build error.
 *
 * The token hashing lives here rather than in sessions.js because both layers
 * need it and the direction of the dependency should be one way: sessions.js
 * imports this, never the reverse.
 */

import { createHash } from "node:crypto";
import { query } from "../db";

/** SHA-256 of the opaque cookie token. Only this is ever stored. */
export function hashToken(token) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Destroy every session for a user.
 *
 * Called after a password change and after 2FA is enabled or disabled — all
 * events where the honest assumption is that other sessions may no longer be
 * the author's. A stolen cookie is exactly what 2FA exists to stop, so leaving
 * one alive would defeat the point of having just enabled it.
 *
 * `exceptSessionId` keeps the current browser signed in, which is what makes
 * "enable 2FA without being logged out" possible. It is a session ROW id, not
 * a token: the caller has already resolved the token to a row.
 */
export async function destroyAllSessions(userId, { exceptSessionId = null } = {}) {
  if (exceptSessionId) {
    await query(`DELETE FROM sessions WHERE user_id = $1 AND id <> $2`, [
      userId,
      exceptSessionId,
    ]);
  } else {
    await query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
  }
}

/**
 * Housekeeping: drop expired rows.
 *
 * Safe to call from anywhere, any time — a cron job, a route, a script. Rows
 * past `expires_at` are already unusable (every read filters on it), so this
 * only reclaims space.
 */
export async function pruneExpiredSessions() {
  const { rowCount } = await query(`DELETE FROM sessions WHERE expires_at <= now()`);
  return rowCount;
}

/**
 * The active sessions for a user, for the "signed-in devices" list in
 * /studio/settings.
 *
 * `user_agent` and `ip` are returned raw and must be escaped at the render
 * site — they are attacker-controlled strings that arrive in a header. The
 * caller is responsible for that; this function does not sanitise, because
 * doing so here would make the values wrong for any other consumer.
 */
export async function listSessions(userId) {
  const rows = await query(
    `SELECT id, created_at, last_used_at, expires_at, user_agent, ip
       FROM sessions
      WHERE user_id = $1 AND expires_at > now()
      ORDER BY last_used_at DESC`,
    [userId]
  );
  return rows.rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
    userAgent: row.user_agent,
    ip: row.ip,
  }));
}

/** End one specific session, by row id. Used by the "sign out that device" button. */
export async function destroySessionById(userId, sessionId) {
  const { rowCount } = await query(
    `DELETE FROM sessions WHERE user_id = $1 AND id = $2`,
    [userId, sessionId]
  );
  return rowCount === 1;
}
