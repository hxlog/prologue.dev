/**
 * Integration test for the auth layer, against the real database.
 *
 *   node --env-file=.env.local --import ./scripts/auth/register-loader.mjs \n *     scripts/auth/auth-test.mjs
 *
 * Creates a throwaway user, exercises every path, then removes it. Uses the
 * direct connection, so nothing here goes through the pooler.
 *
 * One thing this file has to be careful about: TOTP codes are time-based and
 * this script takes over a minute — scrypt is deliberately slow and several
 * sections make dozens of hash calls. A helper that read `Date.now()` inside
 * would mint a different code on every call, and the replay assertions would
 * then be comparing two unrelated values. Every code is therefore derived from
 * an EXPLICIT step; the ones that need "now" ask for it at the moment of use.
 */
import pg from "pg";
import { createHmac } from "node:crypto";

const base = new URL("../../", import.meta.url).href;

process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED;

const { hashPassword, verifyPassword, needsRehash } = await import(base + "src/lib/auth/password.js");
const { generateTotpSecret, verifyTotp, base32Decode } = await import(base + "src/lib/auth/totp.js");
const { generateBackupCodes, consumeBackupCode, countUnusedBackupCodes } = await import(base + "src/lib/auth/backup-codes.js");
const {
  createChallenge,
  peekChallenge,
  recordChallengeAttempt,
  consumeChallenge,
  abandonChallenge,
  CHALLENGE_MAX_ATTEMPTS,
} = await import(base + "src/lib/auth/challenges.js");
const { checkThrottle, recordFailure, clearFailures, attemptsRemaining } = await import(base + "src/lib/auth/throttle.js");
const users = await import(base + "src/lib/auth/users.js");
const totpSettings = await import(base + "src/lib/auth/totp-settings.js");
const { queryOne, queryMany } = await import(base + "src/lib/db/index.js");

const EMAIL = "authtest@example.invalid";
const PASSWORD = "test-password-1234";

let pass = 0;
let fail = 0;

function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    fail++;
    console.log(`  FAIL ${label}\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`);
  }
}

/** A valid TOTP code for an explicit step. Pure — no clock. */
function codeAt(secret, stepValue) {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(stepValue));
  const digest = createHmac("sha1", key).update(buf).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];
  return String(binary % 1000000).padStart(6, "0");
}

const nowStep = () => Math.floor(Date.now() / 1000 / 30);
const codeNow = (secret, offset = 0) => codeAt(secret, nowStep() + offset);

// ------------------------------------------------------------------ setup
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_UNPOOLED });
await admin.connect();
await admin.query(`DELETE FROM users WHERE email = $1`, [EMAIL]);

process.env.OWNER_EMAIL = EMAIL;
const { rows: created } = await admin.query(
  `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id`,
  [EMAIL, "Test", await hashPassword(PASSWORD)]
);
const userId = created[0].id;
const fakeSession = { id: userId, sessionId: "00000000-0000-0000-0000-000000000000", email: EMAIL };

console.log(`\ntest user ${userId}\n`);

try {
  // --------------------------------------------------------------- users
  console.log("users");
  check("isOwner accepts the configured email", users.isOwner(EMAIL), true);
  check("isOwner rejects another email", users.isOwner("someone@else.invalid"), false);
  check("findUserByEmail finds the owner", (await users.findUserByEmail(EMAIL))?.id === userId, true);
  check("findUserByEmail rejects a non-owner", await users.findUserByEmail("someone@else.invalid"), null);
  check("verifyCredentials: correct password", (await users.verifyCredentials(EMAIL, PASSWORD))?.id === userId, true);
  check("verifyCredentials: wrong password", await users.verifyCredentials(EMAIL, "wrong"), null);
  check("verifyCredentials: unknown email", await users.verifyCredentials("nobody@invalid", "x"), null);
  check(
    "OWNER_EMAIL unset blocks everyone",
    await (async () => {
      const saved = process.env.OWNER_EMAIL;
      delete process.env.OWNER_EMAIL;
      const result = await users.verifyCredentials(EMAIL, PASSWORD);
      process.env.OWNER_EMAIL = saved;
      return result;
    })(),
    null
  );

  // ---------------------------------------------------------- challenges
  console.log("\nchallenges");
  const ch = await createChallenge({ userId, userAgent: "test-agent", ip: "203.0.113.7" });
  check("peek returns the challenge", (await peekChallenge(ch.token))?.userId, userId);
  check("peek on garbage returns null", await peekChallenge("nonsense"), null);
  check("peek on null returns null", await peekChallenge(null), null);
  check(
    "attemptsRemaining starts at the max",
    (await peekChallenge(ch.token))?.attemptsRemaining,
    CHALLENGE_MAX_ATTEMPTS
  );

  const a1 = await recordChallengeAttempt(ch.token);
  check("one wrong code leaves max-1", a1.remaining, CHALLENGE_MAX_ATTEMPTS - 1);
  check("not burned after one", a1.burned, false);

  // Single use, exercised as a genuine race rather than a sequential reread.
  const [first, second] = await Promise.all([
    consumeChallenge(ch.token),
    consumeChallenge(ch.token),
  ]);
  check("concurrent consume: exactly one wins", [first, second].filter(Boolean).length, 1);
  check("a consumed challenge cannot be re-peeked", await peekChallenge(ch.token), null);

  const ch2 = await createChallenge({ userId });
  let burned = null;
  for (let i = 0; i < CHALLENGE_MAX_ATTEMPTS; i++) {
    burned = await recordChallengeAttempt(ch2.token);
  }
  check("burns at the attempt limit", burned.burned, true);
  check("a burned challenge is unconsumable", await consumeChallenge(ch2.token), null);

  const ch3 = await createChallenge({ userId });
  await abandonChallenge(ch3.token);
  check("an abandoned challenge is gone", await peekChallenge(ch3.token), null);

  check(
    "an expired challenge is unusable",
    await (async () => {
      const expired = await createChallenge({ userId });
      await admin.query(
        `UPDATE login_challenges SET expires_at = now() - interval '1 second' WHERE token_hash = (
           SELECT token_hash FROM login_challenges WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1)`,
        [userId]
      );
      const peeked = await peekChallenge(expired.token);
      const consumed = await consumeChallenge(expired.token);
      return { peeked, consumed };
    })(),
    { peeked: null, consumed: null }
  );

  // --------------------------------------------------------------- totp
  console.log("\ntotp");
  const secret = generateTotpSecret();
  check("secret is 32 base32 characters", secret.length, 32);
  check("secret decodes to 20 bytes", base32Decode(secret).length, 20);
  check("verifyTotp accepts the current code", verifyTotp(codeNow(secret), secret).ok, true);
  check("verifyTotp rejects a wrong code", verifyTotp(
    codeNow(secret) === "000000" ? "111111" : "000000", secret
  ).ok, false);
  check("verifyTotp tolerance is +/-1 step", [
    verifyTotp(codeNow(secret, -1), secret, { window: 1 }).ok,
    verifyTotp(codeNow(secret, 1), secret, { window: 1 }).ok,
    verifyTotp(codeNow(secret, -2), secret, { window: 1 }).ok,
  ], [true, true, false]);

  // ------------------------------------------------------- totp settings
  console.log("\ntotp settings");
  const begin = await totpSettings.beginTotpEnrollment(fakeSession);
  check("begin returns a secret", typeof begin.secret, "string");
  check("begin returns an otpauth URI", begin.uri.startsWith("otpauth://totp/"), true);
  check("the URI carries the issuer", begin.uri.includes("issuer=Prologue"), true);
  check(
    "the flag is still false after begin",
    (await queryOne(`SELECT totp_enabled FROM users WHERE id=$1`, [userId])).totp_enabled,
    false
  );

  check("confirm with a wrong code fails", (await totpSettings.confirmTotpEnrollment(fakeSession, "000000")).ok, false);

  const storedSecret = (await queryOne(`SELECT totp_secret FROM users WHERE id=$1`, [userId])).totp_secret;
  const confirm = await totpSettings.confirmTotpEnrollment(fakeSession, codeNow(storedSecret));
  check("confirm with the right code succeeds", confirm.ok, true);
  check("confirm issues 10 backup codes", confirm.backupCodes?.length, 10);
  check("backup codes are XXXXX-XXXXX", /^[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(confirm.backupCodes[0]), true);
  check(
    "totp_enabled is now true",
    (await queryOne(`SELECT totp_enabled FROM users WHERE id=$1`, [userId])).totp_enabled,
    true
  );
  check("a second confirm is refused", (await totpSettings.confirmTotpEnrollment(fakeSession, codeNow(storedSecret))).ok, false);
  check("begin refuses once enabled", await totpSettings.beginTotpEnrollment(fakeSession), null);

  // Replay: one step, claimed twice.
  //
  // A 'free step' helper rather than a fixed offset. TOTP only ever accepts
  // three steps at a time — now-1, now, now+1 — and a step already claimed is
  // refused, so the code a test can use depends on BOTH the clock and what
  // previous assertions spent. A fixed +2 offset looks reasonable and is wrong
  // in two directions: it falls outside the window if the clock has not ticked,
  // and inside-but-used if it has. This picks the highest unused step that is
  // still inside the window, and returns null when there is none.
  async function freeStep(secret) {
    const row = await queryOne(
      `SELECT totp_last_step FROM users WHERE id = $1`,
      [userId]
    );
    const used =
      row?.totp_last_step == null ? Number.NEGATIVE_INFINITY : Number(row.totp_last_step);
    for (const step of [nowStep() + 1, nowStep(), nowStep() - 1]) {
      if (step > used) return { step, code: codeAt(secret, step) };
    }
    return null;
  }

  /**
   * Like freeStep, but waits out the window when every accepted step has been
   * spent.
   *
   * Only three steps are ever valid at once, so a section that claims two of
   * them leaves the next assertion with nothing to use — and the honest fix is
   * to wait for the clock rather than to loosen the replay protection the test
   * is there to prove. The wait is at most one 30-second step.
   */
  async function waitForFreeStep(secret) {
    for (;;) {
      const free = await freeStep(secret);
      if (free) return free;
      const msToNextStep = (nowStep() + 1) * 30_000 - Date.now() + 250;
      console.log(`       (waiting ${Math.ceil(msToNextStep / 1000)}s for a fresh TOTP window)`);
      await new Promise((r) => setTimeout(r, msToNextStep));
    }
  }

  const replayFree = await freeStep(storedSecret);
  check('a free step is available', replayFree !== null, true);
  check('claim accepts a fresh step', (await totpSettings.claimTotpCode(userId, replayFree.code)).ok, true);
  check('claim refuses the same step again', (await totpSettings.claimTotpCode(userId, replayFree.code)).ok, false);
  check('the rejection reason is "replayed"', (await totpSettings.claimTotpCode(userId, replayFree.code)).reason, 'replayed');
  check('claim refuses a garbage code', (await totpSettings.claimTotpCode(userId, 'abc')).ok, false);
  check('claim refuses a five-digit code', (await totpSettings.claimTotpCode(userId, '12345')).ok, false);

  // ---------------------------------------------------------- backup codes
  console.log("\nbackup codes");
  check("count is 10", await countUnusedBackupCodes(userId), 10);
  const bc = confirm.backupCodes[0];
  check("an unused code is accepted", await consumeBackupCode(userId, bc), true);
  check("the same code is refused again", await consumeBackupCode(userId, bc), false);
  check("count dropped to 9", await countUnusedBackupCodes(userId), 9);
  check("a different code still works", await consumeBackupCode(userId, confirm.backupCodes[1]), true);
  check("lowercase and spaces are normalised", await consumeBackupCode(userId, ` ${confirm.backupCodes[2].toLowerCase()} `), true);
  check("the dash is optional", await consumeBackupCode(userId, confirm.backupCodes[3].replace("-", "")), true);
  check("a wrong code is refused", await consumeBackupCode(userId, "AAAAA-BBBBB"), false);
  check("count is now 6", await countUnusedBackupCodes(userId), 6);

  const raceCode = confirm.backupCodes[4];
  const raceResults = await Promise.all([
    consumeBackupCode(userId, raceCode),
    consumeBackupCode(userId, raceCode),
  ]);
  check("concurrent use of one backup code: one winner", raceResults.filter(Boolean).length, 1);

  // -------------------------------------------------------------- throttle
  console.log("\nthrottle");
  await admin.query(`DELETE FROM login_attempts`);
  const tEmail = "throttle-test@example.invalid";
  const tIp = "198.51.100.42";
  const clearAll = () => clearFailures({ email: tEmail, ip: tIp });

  check("a clean state allows", (await checkThrottle({ email: tEmail, ip: tIp })).ok, true);
  check("attemptsRemaining starts at 5", await attemptsRemaining({ email: tEmail, ip: tIp }), 5);

  const locks = [];
  for (let i = 1; i <= 5; i++) {
    locks.push((await recordFailure({ email: tEmail, ip: tIp })).lockedForSeconds);
  }
  check("the first four failures do not lock", locks.slice(0, 4), [0, 0, 0, 0]);
  check("the fifth locks", locks[4] > 0, true);
  check("attemptsRemaining is 0 when locked", await attemptsRemaining({ email: tEmail, ip: tIp }), 0);

  const blocked = await checkThrottle({ email: tEmail, ip: tIp });
  check("a locked key is refused", blocked.ok, false);
  check("the refusal carries retryAfter", blocked.retryAfterSeconds > 0, true);
  check("the lockout is bounded at one hour", blocked.retryAfterSeconds <= 3600, true);

  await clearAll();
  check("clearFailures resets both keys", (await checkThrottle({ email: tEmail, ip: tIp })).ok, true);
  check("attemptsRemaining is restored", await attemptsRemaining({ email: tEmail, ip: tIp }), 5);

  // The IP ladder must NOT fire before the account ladder. It is a backstop for
  // scrypt-work amplification, not a second, stricter limit on the author: at a
  // lower threshold it locked the author out of their own IP after a few typos.
  //
  // 25 attempts, not 20: the ladder's first non-zero entry is indexed by the
  // failure COUNT, so a 20-iteration loop stops one short of it and the test
  // would pass for the wrong reason. The count is what the index means.
  await admin.query(`DELETE FROM login_attempts`);
  const spreadEmail = "spread-test@example.invalid";
  let ipFiredEarly = false;
  for (let i = 0; i < 25; i++) {
    const r = await recordFailure({ email: spreadEmail, ip: tIp });
    // The account ladder fires on the 5th failure; the IP ladder must not fire
    // in the first four.
    if (r.lockedForSeconds > 0 && i < 4) ipFiredEarly = true;
  }
  check("the IP ladder does not fire before the account ladder", ipFiredEarly, false);
  check("the IP ladder does fire eventually", (await checkThrottle({ email: "other@invalid", ip: tIp })).ok, false);

  await admin.query(`DELETE FROM login_attempts`);
  let accountLock = 0;
  for (let i = 0; i < 6; i++) {
    const r = await recordFailure({ email: tEmail, ip: `10.0.0.${i}` });
    accountLock = Math.max(accountLock, r.lockedForSeconds);
  }
  check("the account ladder locks across distinct IPs", accountLock > 0, true);
  check("the account key alone blocks", (await checkThrottle({ email: tEmail, ip: "10.9.9.9" })).ok, false);

  // A null IP must record nothing, rather than bucketing every anonymous
  // client under one key.
  await admin.query(`DELETE FROM login_attempts`);
  const noIp1 = await recordFailure({ email: "a@invalid", ip: null });
  const noIp2 = await recordFailure({ email: "b@invalid", ip: null });
  check("a null IP records no failures", [noIp1.lockedForSeconds, noIp2.lockedForSeconds], [0, 0]);
  check("a null IP allows", (await checkThrottle({ email: "c@invalid", ip: null })).ok, true);

  // ------------------------------------------------------------- disabling
  console.log("\ndisable 2fa");
  check(
    "disable needs the password",
    (await totpSettings.disableTotp(fakeSession, { password: "wrong", code: "000000" })).reason,
    "bad_password"
  );

  // The account is still enrolled. Confirm spent its own step and the replay
  // test claimed one more, so the code has to come from whichever step is
  // still unspent — see waitForFreeStep.
  check(
    "disable needs a valid code",
    (await totpSettings.disableTotp(fakeSession, { password: PASSWORD, code: "000000" })).reason,
    "bad_code"
  );

  const disableFree = await waitForFreeStep(storedSecret);
  const disabled = await totpSettings.disableTotp(fakeSession, {
    password: PASSWORD,
    code: disableFree.code,
  });
  check("disable with password + code succeeds", disabled.ok, true);
  check(
    "totp_enabled is false",
    (await queryOne(`SELECT totp_enabled FROM users WHERE id=$1`, [userId])).totp_enabled,
    false
  );
  check("the secret is cleared", (await queryOne(`SELECT totp_secret FROM users WHERE id=$1`, [userId])).totp_secret, null);
  check("backup codes are cleared", await countUnusedBackupCodes(userId), 0);

  // The arm that matters when the authenticator is gone.
  const begin2 = await totpSettings.beginTotpEnrollment(fakeSession);
  const confirm2 = await totpSettings.confirmTotpEnrollment(fakeSession, codeNow(begin2.secret));
  const disabled2 = await totpSettings.disableTotp(fakeSession, {
    password: PASSWORD,
    backupCode: confirm2.backupCodes[0],
  });
  check("disable via a backup code succeeds", disabled2.ok, true);
  check("the backup code used to disable is burned", await consumeBackupCode(userId, confirm2.backupCodes[0]), false);
  check("the remaining backup codes were cleared", await consumeBackupCode(userId, confirm2.backupCodes[1]), false);

  check("getTotpState reports disabled", (await totpSettings.getTotpState(userId)).enabled, false);

  // -------------------------------------------------------- re-enrollment
  console.log("\nre-enrollment after disabling");
  const again = await totpSettings.beginTotpEnrollment(fakeSession);
  check("begin works again after disabling", typeof again.secret, "string");
  const confirmed3 = await totpSettings.confirmTotpEnrollment(fakeSession, codeNow(again.secret));
  check("re-enrollment succeeds", confirmed3.ok, true);
  check("re-enrollment issues a fresh set of 10", confirmed3.backupCodes?.length, 10);
  check("getTotpState reports enabled", (await totpSettings.getTotpState(userId)).enabled, true);
  check("verifiedAt is recorded", (await totpSettings.getTotpState(userId)).verifiedAt instanceof Date, true);

  // ------------------------------------------------------ password upgrade
  console.log("\npassword upgrade path");
  const { scrypt: scryptCb, randomBytes } = await import("node:crypto");
  const { promisify } = await import("node:util");
  const scrypt = promisify(scryptCb);
  const salt = randomBytes(16);
  const weakKey = await scrypt(PASSWORD, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
  const weakHash = `scrypt$N=16384,r=8,p=1$${salt.toString("base64")}$${weakKey.toString("base64")}`;

  check("a weaker-parameter hash still verifies", await verifyPassword(PASSWORD, weakHash), true);
  check("it rejects a wrong password", await verifyPassword("wrong", weakHash), false);
  check("needsRehash is true for weaker parameters", needsRehash(weakHash), true);
  check("needsRehash is false for current parameters", needsRehash(await hashPassword("x")), false);
  check("needsRehash is true for garbage", needsRehash("not-a-hash"), true);
  check(
    "a stored hash demanding 1 GiB is refused, not attempted",
    await verifyPassword("x", "scrypt$N=1073741824,r=8,p=1$YWJjZGVmZ2hpamts$YWJjZGVmZ2hpamts"),
    false
  );
  check("verifyPassword rejects a bcrypt string", await verifyPassword("x", "$2b$10$abcdefghijklmnopqrstuv"), false);
  check("verifyPassword rejects an empty password", await verifyPassword("", weakHash), false);
  check("verifyPassword rejects null", await verifyPassword(null, weakHash), false);
} catch (err) {
  console.log(`\n!! THREW: ${err.message}\n${err.stack}`);
  fail++;
} finally {
  await admin.query(`DELETE FROM users WHERE email = $1`, [EMAIL]);
  await admin.query(`DELETE FROM login_attempts`);
  await admin.end();
  const { pool } = await import(base + "src/lib/db/index.js");
  await pool.end();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
