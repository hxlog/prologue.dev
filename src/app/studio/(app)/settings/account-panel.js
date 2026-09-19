"use client";

import { useState } from "react";
import qrcode from "qrcode-generator";

import {
  beginTotpAction,
  changePasswordAction,
  confirmTotpAction,
  disableTotpAction,
} from "../../actions/settings";
import { IconCheck, IconWarning } from "../../../../components/studio/icons";

/**
 * The account: password and second factor.
 *
 * ## The enrollment flow is two steps and neither is optional
 *
 * `beginTotpAction` writes a secret to the user row UNCONFIRMED and returns a
 * provisioning URI. Nothing is enabled yet — a secret that was scanned wrong
 * would otherwise lock the author out of their own site. Only
 * `confirmTotpAction`, which verifies a code against the stored secret, flips
 * `totp_enabled` and issues the backup codes.
 *
 * The backup codes are shown ONCE, on the confirm response, and never stored in
 * a readable form — the table holds hashes. So this is the only moment they
 * exist in the clear, and the screen says so rather than letting the author
 * click past them.
 *
 * ## Why the QR is rendered locally, not fetched
 *
 * The `otpauth://` URI contains the TOTP SECRET. A QR rendered by a third-party
 * service is that secret sent to that service, and the whole point of a second
 * factor is that the secret lives in exactly two places. So the encoder is a
 * bundled dependency — see the note on `QrCode` — and the manual-key fallback
 * is shown beside it for an app that cannot scan.
 */
export function AccountPanel({ account, totp }) {
  const [state, setState] = useState(totp);
  const [enrollment, setEnrollment] = useState(null);
  const [backupCodes, setBackupCodes] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  const [code, setCode] = useState("");
  const [disable, setDisable] = useState({ password: "", code: "" });

  async function run(fn) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      return await fn();
    } catch (err) {
      setError(err?.message ?? "操作失败");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function startEnrollment() {
    const result = await run(beginTotpAction);
    if (result?.ok) setEnrollment({ secret: result.secret, uri: result.uri, formatted: result.formatted });
    else if (result) setError(totpProblem(result.reason));
  }

  async function confirm(e) {
    e.preventDefault();
    const result = await run(() => confirmTotpAction(code));
    if (!result) return;

    if (result.ok) {
      setBackupCodes(result.backupCodes);
      setEnrollment(null);
      setCode("");
      setState({ enabled: true, unusedBackupCodes: result.backupCodes.length });
      setNotice("两步验证已开启。其他设备的登录已被注销。");
    } else {
      setError(totpProblem(result.reason));
    }
  }

  async function turnOff(e) {
    e.preventDefault();
    const result = await run(() => disableTotpAction(disable));
    if (!result) return;

    if (result.ok) {
      setState({ enabled: false, unusedBackupCodes: 0 });
      setDisable({ password: "", code: "" });
      setNotice("两步验证已关闭。");
    } else {
      setError(totpProblem(result.reason));
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-xl border border-accent/30 bg-accent-soft px-4 py-3 text-sm text-accent">
          {notice}
        </p>
      )}

      <Section title="账号">
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-faint">邮箱</dt>
            <dd className="mt-0.5 font-mono text-xs text-foreground">{account.email}</dd>
          </div>
          <div>
            <dt className="text-xs text-faint">名称</dt>
            <dd className="mt-0.5 text-foreground">{account.name || "—"}</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-faint">
          只有一个账号，没有公开注册入口。新增账号需要使用 scripts/admin 下的脚本。
        </p>
      </Section>

      <Section title="两步验证" hint={state.enabled ? "已开启" : "未开启"}>
        {!state.enabled && !enrollment && (
          <>
            <p className="text-xs leading-6 text-muted">
              开启后，登录需要密码加一个 6 位动态码。动态码由验证器应用生成，
              站点不会保存它，也看不到它。
            </p>
            <button
              type="button"
              onClick={startEnrollment}
              disabled={busy}
              className={primary}
            >
              开始设置
            </button>
          </>
        )}

        {enrollment && (
          <form onSubmit={confirm} className="space-y-3">
            <ol className="list-decimal space-y-1 pl-4 text-xs leading-6 text-muted">
              <li>用验证器应用扫描下面的二维码，或手动输入密钥。</li>
              <li>输入应用显示的 6 位动态码完成开启。</li>
            </ol>

            <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
              <QrCode value={enrollment.uri} />
              <div className="min-w-0">
                <p className="text-xs text-faint">手动输入密钥</p>
                <p className="mt-1 break-all font-mono text-sm text-foreground">
                  {enrollment.formatted}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label htmlFor="totp-code" className="mb-1 block text-xs font-medium text-muted">
                  动态码
                </label>
                <input
                  id="totp-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="000000"
                  className={`${input} w-32 font-mono tracking-widest`}
                />
              </div>
              <button type="submit" disabled={busy || !code} className={primary}>
                {busy ? "验证中…" : "确认开启"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEnrollment(null);
                  setCode("");
                }}
                className={ghost}
              >
                取消
              </button>
            </div>
          </form>
        )}

        {state.enabled && (
          <form onSubmit={turnOff} className="space-y-3">
            <p className="flex items-start gap-2 text-xs leading-6 text-muted">
              <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
              <span>
                已开启，剩余备用码 {state.unusedBackupCodes} 个。
                关闭需要同时提供密码和当前动态码——否则一个没锁屏的浏览器就足以关掉它。
              </span>
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="disable-password"
                  className="mb-1 block text-xs font-medium text-muted"
                >
                  密码
                </label>
                <input
                  id="disable-password"
                  type="password"
                  autoComplete="current-password"
                  value={disable.password}
                  onChange={(e) => setDisable({ ...disable, password: e.target.value })}
                  className={input}
                />
              </div>
              <div>
                <label
                  htmlFor="disable-code"
                  className="mb-1 block text-xs font-medium text-muted"
                >
                  动态码或备用码
                </label>
                <input
                  id="disable-code"
                  type="text"
                  value={disable.code}
                  onChange={(e) => setDisable({ ...disable, code: e.target.value })}
                  className={input}
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={busy || !disable.password || !disable.code}
              className={danger}
            >
              关闭两步验证
            </button>
          </form>
        )}

        {backupCodes && (
          <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
            <p className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-500">
              <IconWarning className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                备用码只显示这一次，之后无法再查看。每个码只能用一次，
                用于验证器不可用时登录。
              </span>
            </p>
            <ul className="mt-2 grid grid-cols-2 gap-1 font-mono text-sm text-foreground sm:grid-cols-4">
              {backupCodes.map((c) => (
                <li key={c} className="rounded bg-surface-2 px-2 py-1 text-center">
                  {c}
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setBackupCodes(null)}
              className={`${ghost} mt-3`}
            >
              我已保存
            </button>
          </div>
        )}
      </Section>

      <PasswordPanel />
    </div>
  );
}

function PasswordPanel() {
  const [form, setForm] = useState({ current: "", next: "", again: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const mismatch = form.again !== "" && form.next !== form.again;
  const tooShort = form.next !== "" && form.next.length < 12;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await changePasswordAction({
        current: form.current,
        next: form.next,
      });
      if (result.ok) {
        setForm({ current: "", next: "", again: "" });
        setNotice("密码已修改，其他设备的登录已被注销。");
      } else {
        setError(passwordProblem(result.reason));
      }
    } catch (err) {
      setError(err?.message ?? "修改失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="修改密码">
      <form onSubmit={submit} className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-3">
          <Labelled label="当前密码" id="pw-current">
            <input
              id="pw-current"
              type="password"
              autoComplete="current-password"
              value={form.current}
              onChange={(e) => setForm({ ...form, current: e.target.value })}
              className={input}
            />
          </Labelled>
          <Labelled label="新密码" id="pw-next">
            <input
              id="pw-next"
              type="password"
              autoComplete="new-password"
              value={form.next}
              onChange={(e) => setForm({ ...form, next: e.target.value })}
              className={input}
            />
          </Labelled>
          <Labelled label="再次输入" id="pw-again">
            <input
              id="pw-again"
              type="password"
              autoComplete="new-password"
              value={form.again}
              onChange={(e) => setForm({ ...form, again: e.target.value })}
              className={input}
            />
          </Labelled>
        </div>

        {tooShort && <p className="text-xs text-amber-600 dark:text-amber-500">至少 12 个字符。</p>}
        {mismatch && <p className="text-xs text-red-500">两次输入不一致。</p>}
        {error && <p className="text-xs text-red-500">{error}</p>}
        {notice && <p className="text-xs text-accent">{notice}</p>}

        <button
          type="submit"
          disabled={busy || !form.current || !form.next || mismatch || tooShort}
          className={primary}
        >
          {busy ? "修改中…" : "修改密码"}
        </button>

        <p className="text-[11px] leading-5 text-faint">
          修改后其他设备会被注销，当前浏览器保持登录。
        </p>
      </form>
    </Section>
  );
}
function Section({ title, hint, children }) {
  return (
    <section className="rounded-xl border border-border bg-surface">
      <div className="flex items-baseline justify-between border-b border-border px-3 py-2">
        <h2 className="text-xs font-medium text-muted">{title}</h2>
        {hint && <span className="text-[11px] text-faint">{hint}</span>}
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}

function Labelled({ label, id, children }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-muted">
        {label}
      </label>
      {children}
    </div>
  );
}

function totpProblem(reason) {
  switch (reason) {
    case "already_enabled":
      return "两步验证已经开启。";
    case "not_started":
      return "设置已过期，请重新开始。";
    case "bad_code":
      return "动态码不正确。确认手机时间准确后重试。";
    case "wrong_password":
      return "密码不正确。";
    case "bad_backup_code":
      return "备用码不正确或已使用过。";
    default:
      return "操作失败，请重试。";
  }
}

function passwordProblem(reason) {
  switch (reason) {
    case "too_short":
      return "新密码至少需要 12 个字符。";
    case "wrong_password":
      return "当前密码不正确。";
    default:
      return "修改失败，请重试。";
  }
}


/**
 * The provisioning QR, drawn locally.
 *
 * `qrcode-generator` (MIT, by the author of the QR reference implementation)
 * rather than a rendering service, and the difference matters here: the
 * `otpauth://` URI contains the TOTP SECRET. A QR rendered by a third-party
 * endpoint is that secret sent to that third party, and the whole point of a
 * second factor is that the secret lives in exactly two places — the
 * authenticator app and the `users` row.
 *
 * It is a dependency rather than twenty lines because encoding Reed–Solomon
 * over GF(256) correctly is not twenty lines, and a QR that is subtly wrong is
 * worse than no QR at all: the author scans it, the secret is garbage, and
 * nothing tells them which half was at fault. 11 kB gzipped.
 *
 * Level M, chosen by the library for the URI's length. The version
 * auto-selects too, so this needs no knowledge of how long an `otpauth://` URI
 * happens to be.
 */
function QrCode({ value }) {
  let modules = null;
  try {
    const qr = qrcode(0, "M");
    qr.addData(value, "Byte");
    qr.make();
    const count = qr.getModuleCount();
    modules = [];
    for (let row = 0; row < count; row++) {
      const cells = [];
      for (let col = 0; col < count; col++) cells.push(qr.isDark(row, col) ? 1 : 0);
      modules.push(cells);
    }
  } catch {
    // A URI too long for any version throws.
    modules = null;
  }

  if (!modules) {
    return (
      <div className="flex h-[148px] w-[148px] shrink-0 items-center justify-center rounded-lg border border-border bg-surface-2 p-3 text-center text-[11px] text-faint">
        无法生成二维码，请手动输入密钥
      </div>
    );
  }

  const size = modules.length;
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className="h-[148px] w-[148px] shrink-0 rounded-lg bg-white p-1.5"
      role="img"
      aria-label="两步验证二维码"
      shapeRendering="crispEdges"
    >
      {modules.flatMap((row, y) =>
        row.map((on, x) =>
          on ? (
            <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="#000" />
          ) : null
        )
      )}
    </svg>
  );
}

const primary =
  "rounded-lg px-3 py-2 text-sm font-medium text-white transition-opacity " +
  "hover:opacity-90 disabled:opacity-40";

const ghost =
  "rounded-lg border border-border px-3 py-2 text-sm text-muted transition-colors " +
  "hover:bg-surface-2 hover:text-accent disabled:opacity-50";

const danger =
  "rounded-lg border border-red-500/40 px-3 py-2 text-sm text-red-500 " +
  "transition-colors hover:bg-red-500/10 disabled:opacity-40";

const input =
  "w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-foreground " +
  "placeholder:text-faint transition-colors focus:border-accent focus:outline-none " +
  "focus-visible:ring-2 focus-visible:ring-accent/40";
