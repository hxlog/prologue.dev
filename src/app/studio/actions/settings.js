/**
 * Settings actions: the account, the second factor, the sessions, and the
 * redirect table.
 *
 * Everything here is a write to the AUTHOR'S OWN account, so every one of them
 * re-derives the user from the session rather than trusting an id from the
 * client. A settings screen that accepted a user id would be a way to change
 * someone else's password, and the fact that there is only one user today is
 * not a reason to build it that way.
 *
 * ## Why a password change does not sign the other sessions out silently
 *
 * It does sign them out — see `changePassword` — and that IS the right default:
 * a password change is how someone responds to a suspected compromise, and
 * leaving the attacker's session alive would defeat it. The current session is
 * kept, because signing the author out of the browser they are standing in
 * makes the screen they just used look broken.
 */

"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "../../../lib/auth/require";
import { setPassword, verifyCredentials } from "../../../lib/auth/users";
import {
  destroyAllSessions,
  destroySessionById,
  listSessions,
} from "../../../lib/auth/session-store";
import {
  beginTotpEnrollment,
  confirmTotpEnrollment,
  disableTotp,
  getTotpState,
} from "../../../lib/auth/totp-settings";
import { countUnusedBackupCodes } from "../../../lib/auth/backup-codes";
import {
  deleteRedirect,
  listRedirects,
  setRedirect,
} from "../../../lib/studio/redirects";

/* ── the second factor ───────────────────────────────────────────────────── */

/**
 * Step one: mint a secret and show the QR.
 *
 * Returns the secret and its provisioning URI. Deliberately NOT cached or
 * stored anywhere but the `users` row, unconfirmed — the screen holds the
 * secret in state until the author proves they scanned it.
 */
export async function beginTotpAction() {
  const session = await requireUser();
  const enrollment = await beginTotpEnrollment(session.user);
  if (!enrollment) return { ok: false, reason: "already_enabled" };
  return { ok: true, ...enrollment };
}

/** Step two: the author typed a code, so the factor is real. */
export async function confirmTotpAction(code) {
  const session = await requireUser();
  const result = await confirmTotpEnrollment(session.user, String(code ?? ""));
  if (result.ok) revalidatePath("/studio/settings");
  return result;
}

/**
 * Turn the second factor off.
 *
 * Requires the password AND a current code, and `disableTotp` is what enforces
 * it. That is not belt-and-braces: a session left open on a shared machine is
 * exactly the situation a second factor exists for, and a "disable" button that
 * only needed the session would hand it back.
 */
export async function disableTotpAction({ password, code, backupCode }) {
  const session = await requireUser();
  const result = await disableTotp(session.user, {
    password: String(password ?? ""),
    code: code ? String(code) : undefined,
    backupCode: backupCode ? String(backupCode) : undefined,
  });
  if (result.ok) revalidatePath("/studio/settings");
  return result;
}

export async function loadTotpStateAction() {
  const session = await requireUser();
  const [state, unused] = await Promise.all([
    getTotpState(session.user.id),
    countUnusedBackupCodes(session.user.id),
  ]);
  return { ok: true, state, unusedBackupCodes: unused };
}

/* ── the password ────────────────────────────────────────────────────────── */

/**
 * Change the password.
 *
 * The current password is re-verified against the database even though the
 * caller already has a session, for the same reason the disable path does:
 * a session is evidence that someone signed in once, not that the person
 * sitting here now is the owner.
 *
 * `destroyAllSessions` except the current one, and `setPassword` rehashes with
 * the current scrypt parameters so a password set years ago is upgraded when it
 * is next changed.
 */
export async function changePasswordAction({ current, next }) {
  const session = await requireUser();

  const password = String(next ?? "");
  if (password.length < 12) return { ok: false, reason: "too_short" };

  const verified = await verifyCredentials(session.user.email, String(current ?? ""));
  if (!verified) return { ok: false, reason: "wrong_password" };

  await setPassword(session.user.id, password);
  // No count returned: `destroyAllSessions` issues a DELETE and reports
  // nothing, and making it return a rowCount just to render "3 devices signed
  // out" would be a schema-shaped change for a sentence. The screen refreshes
  // and the list is the answer.
  await destroyAllSessions(session.user.id, { exceptSessionId: session.sessionId });

  revalidatePath("/studio/settings");
  return { ok: true };
}

/* ── the sessions ────────────────────────────────────────────────────────── */

export async function listSessionsAction() {
  const session = await requireUser();
  const sessions = await listSessions(session.user.id);
  return { ok: true, sessions, currentId: session.sessionId };
}

/**
 * Sign one device out.
 *
 * The current session is refused rather than handled: "sign out this device"
 * that signs you out is a button that lies about what it does. The sign-out
 * control in the rail is the way to end the session you are using.
 */
export async function endSessionAction(sessionId) {
  const session = await requireUser();
  if (sessionId === session.sessionId) return { ok: false, reason: "current" };

  const ended = await destroySessionById(session.user.id, sessionId);
  if (ended) revalidatePath("/studio/settings");
  return { ok: ended, reason: ended ? undefined : "not_found" };
}

/** Sign out everything else. The panic button, and it keeps this session. */
export async function endOtherSessionsAction() {
  const session = await requireUser();
  await destroyAllSessions(session.user.id, { exceptSessionId: session.sessionId });
  revalidatePath("/studio/settings");
  return { ok: true };
}

/* ── redirects ───────────────────────────────────────────────────────────── */

export async function listRedirectsAction() {
  await requireUser();
  return { ok: true, redirects: await listRedirects() };
}

export async function saveRedirectAction(source, destination, permanent = true) {
  await requireUser();
  const result = await setRedirect(source, destination, { permanent });
  if (result.ok) {
    revalidatePath("/studio/settings");
    revalidatePath("/studio/redirects");
  }
  return result;
}

export async function deleteRedirectAction(source) {
  await requireUser();
  const result = await deleteRedirect(source);
  if (result.ok) {
    revalidatePath("/studio/settings");
    revalidatePath("/studio/redirects");
  }
  return result;
}
