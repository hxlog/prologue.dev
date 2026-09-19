/**
 * Sign-in, as two server actions rather than two routes.
 *
 * Server actions, not route handlers, for a specific reason: the outcome of a
 * failed sign-in is a *message on the form the user is looking at* — "wrong
 * password", "that code has expired", "try again in 4 minutes". A route handler
 * returning JSON would need the client to re-render that state, duplicating the
 * validation and error copy in two places. An action returns the error to the
 * component that rendered the form, and the form is the only thing that knows
 * how to show it.
 *
 * Order of operations in `signIn`, and every step is load-bearing:
 *
 *   1. Throttle check BEFORE the password. If the key is locked, do not hash —
 *      the scrypt call is the expensive part an attacker is trying to make us
 *      do, so a locked key must not reach it.
 *   2. Verify the password. A wrong one records a failure and returns.
 *   3. If 2FA is on, issue a challenge and return "needs code" — do NOT create
 *      a session. This is the point of the whole two-phase design.
 *   4. Only otherwise create the session.
 */

"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { verifyCredentials, findUserById } from "../../../lib/auth/users";
import { createSession, destroySession } from "../../../lib/auth/sessions";
import { checkThrottle, recordFailure, clearFailures } from "../../../lib/auth/throttle";
import {
  createChallenge,
  peekChallenge,
  consumeChallenge,
  recordChallengeAttempt,
} from "../../../lib/auth/challenges";
import { claimTotpCode } from "../../../lib/auth/totp-settings";
import { consumeBackupCode, countUnusedBackupCodes } from "../../../lib/auth/backup-codes";
import { clientIp, userAgent } from "../../../lib/auth/request";

/**
 * A generic failure message.
 *
 * Deliberately the same string for "no such user", "wrong password", and
 * "unknown failure", so the form cannot be used to test whether an address has
 * an account. The throttle is per-account, so the *timing* already leaks a
 * little (a locked account responds instantly) — but that requires triggering
 * the lock, which is itself the thing the throttle is reporting.
 */
const GENERIC_FAILURE = "邮箱或密码不正确";

export async function signIn(prevState, formData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { step: "credentials", error: "请填写邮箱和密码" };
  }

  const requestHeaders = await headers();
  // `headers()` returns a Headers-like object, but the helpers take a Request.
  // Wrap it so the same accessors work for both this and the route handlers.
  const request = { headers: requestHeaders };
  const ip = clientIp(request);
  const ua = userAgent(request);

  const gate = await checkThrottle({ email, ip });
  if (!gate.ok) {
    return {
      step: "credentials",
      error: `尝试次数过多，请在 ${formatWait(gate.retryAfterSeconds)}后重试`,
      retryAfterSeconds: gate.retryAfterSeconds,
    };
  }

  const user = await verifyCredentials(email, password);

  if (!user) {
    const { lockedForSeconds } = await recordFailure({ email, ip });
    return {
      step: "credentials",
      error:
        lockedForSeconds > 0
          ? `尝试次数过多，请在 ${formatWait(lockedForSeconds)}后重试`
          : GENERIC_FAILURE,
      retryAfterSeconds: lockedForSeconds || undefined,
    };
  }

  // Password is correct. Clear the counters now rather than after the second
  // factor: the account key is what the author is trying to get past, and
  // making them also clear a lockout by completing 2FA would mean a phone with
  // a dead battery locks them out for an hour.
  await clearFailures({ email, ip });

  if (user.totp_enabled) {
    const challenge = await createChallenge({ userId: user.id, userAgent: ua, ip });
    return { step: "totp", challengeToken: challenge.token };
  }

  await createSession({ userId: user.id, userAgent: ua, ip });
  redirect("/studio");
}

/**
 * Second phase: a TOTP code, or a backup code.
 *
 * The submitted token is taken from a hidden field, and the challenge is
 * consumed only after the code verifies — so a typo does not end the sign-in.
 * `recordChallengeAttempt` counts the failure and burns the challenge at the
 * limit, which forces a fresh (rate-limited) password check.
 */
export async function verifySecondFactor(prevState, formData) {
  const token = String(formData.get("challengeToken") ?? "");
  const code = String(formData.get("code") ?? "").trim();
  const useBackup = formData.get("useBackup") === "1";

  if (!token) {
    return { step: "credentials", error: "会话已过期，请重新登录" };
  }
  if (!code) {
    return { step: "totp", challengeToken: token, error: useBackup ? "请输入备用码" : "请输入验证码" };
  }

  const requestHeaders = await headers();
  const request = { headers: requestHeaders };
  const ip = clientIp(request);
  const ua = userAgent(request);

  // The challenge identifies the user; it is the only thing that does, at this
  // point — the password is no longer in play and must not be trusted from a
  // hidden field.
  const challenge = await peekChallenge(token);
  if (!challenge) {
    return { step: "credentials", error: "会话已过期，请重新登录" };
  }

  let verified = false;
  let failureReason = null;

  if (useBackup) {
    verified = await consumeBackupCode(challenge.userId, code);
    if (!verified) failureReason = "备用码无效或已被使用";
  } else {
    const result = await claimTotpCode(challenge.userId, code);
    verified = result.ok;
    failureReason =
      result.reason === "replayed"
        ? "该验证码已被使用，请等待下一个"
        : "验证码不正确";
  }

  if (!verified) {
    const { remaining, burned } = await recordChallengeAttempt(token);
    if (burned) {
      return { step: "credentials", error: "尝试次数过多，请重新登录" };
    }
    return {
      step: "totp",
      challengeToken: token,
      error: `${failureReason}（还剩 ${remaining} 次）`,
    };
  }

  // Single use: this can only succeed once, even under concurrent submissions.
  const consumed = await consumeChallenge(token);
  if (!consumed) {
    return { step: "credentials", error: "会话已过期，请重新登录" };
  }

  const user = await findUserById(consumed.userId);
  if (!user) {
    return { step: "credentials", error: GENERIC_FAILURE };
  }

  await createSession({ userId: user.id, userAgent: ua, ip });

  // A backup code is a recovery credential, so the author should be told how
  // many are left before they close the tab — and told loudly when it was the
  // last one.
  if (useBackup) {
    const remaining = await countUnusedBackupCodes(user.id);
    if (remaining <= 2) {
      // Redirect rather than return, because the session now exists and the
      // sign-in form must not still be on screen. The count rides in a query
      // parameter that the settings page reads.
      redirect(`/studio/settings?backupCodesLow=${remaining}`);
    }
  }

  redirect("/studio");
}

/** Sign out of this browser only. Other devices keep their sessions. */
export async function signOut() {
  await destroySession();
  redirect("/");
}

/**
 * "4 分钟" / "30 秒" — a duration a person can read.
 *
 * Rounds UP. A message saying "in 0 seconds" is worse than useless: it invites
 * an immediate retry that fails again. Anything under a minute is reported in
 * seconds with a floor of 1.
 */
function formatWait(seconds) {
  const s = Math.max(1, Math.ceil(seconds));
  if (s < 60) return `${s} 秒`;
  const m = Math.ceil(s / 60);
  if (m < 60) return `${m} 分钟`;
  return `${Math.ceil(m / 60)} 小时`;
}
