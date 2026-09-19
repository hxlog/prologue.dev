"use client";

import { useActionState, useState } from "react";
import { signIn, verifySecondFactor } from "../../actions/auth";

/**
 * The primary submit button.
 *
 * The gradient is applied inline rather than as a Tailwind utility because
 * `--gradient-brand` is a CSS custom property holding a `linear-gradient()`,
 * and Tailwind has no `bg-[var(--x)]` mapping for a value that is itself a
 * gradient shorthand — the arbitrary-value form would emit
 * `background-image: var(--gradient-brand)` in some cases and
 * `background-color` in others depending on how the value is written. The
 * inline style is unambiguous, and it is what every other gradient in this
 * codebase does (see card.js, aboutme.js, modal.js).
 */
function SubmitButton({ pending, children }) {
  return (
    <button
      type="submit"
      disabled={pending}
      style={{ background: "var(--gradient-brand)" }}
      className="w-full rounded-lg px-4 py-2 text-sm font-medium text-white transition-opacity
                 hover:opacity-90 focus-visible:outline focus-visible:outline-2
                 focus-visible:outline-offset-2 focus-visible:outline-accent
                 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {children}
    </button>
  );
}

/**
 * The sign-in form, two steps in one component.
 *
 * Both steps are rendered by the same client component because the second
 * appears in place of the first — same card, same position — and swapping
 * components would remount the panel and lose the focus ring the user is
 * already looking at.
 *
 * The challenge token travels in a hidden field. It is NOT the session: it
 * identifies a half-finished sign-in, expires in five minutes, is single-use,
 * and only becomes a session once a valid code arrives with it. Putting it in
 * the page rather than a cookie means a stale tab cannot silently resume a
 * sign-in the user has forgotten about.
 */
export default function SignInForm() {
  const [state, formAction, pending] = useActionState(signIn, { step: "credentials" });
  const [useBackup, setUseBackup] = useState(false);

  if (state.step === "totp") {
    return (
      <form action={verifySecondFactor} className="space-y-4">
        <input type="hidden" name="challengeToken" value={state.challengeToken} />
        <input type="hidden" name="useBackup" value={useBackup ? "1" : "0"} />

        <p className="text-sm text-muted">
          {useBackup
            ? "输入一个未使用过的备用码。每个备用码只能使用一次。"
            : "输入验证器应用中的 6 位验证码。"}
        </p>

        <div>
          <label htmlFor="code" className="mb-1.5 block text-sm font-medium text-foreground">
            {useBackup ? "备用码" : "验证码"}
          </label>
          <input
            id="code"
            name="code"
            type="text"
            required
            autoFocus
            autoComplete="one-time-code"
            inputMode={useBackup ? "text" : "numeric"}
            placeholder={useBackup ? "XXXXX-XXXXX" : "000000"}
            maxLength={useBackup ? 11 : 6}
            className={inputClass}
          />
        </div>

        {state.error && <p className="text-sm text-red-500">{state.error}</p>}

        <SubmitButton pending={pending}>{pending ? "验证中…" : "验证并登录"}</SubmitButton>

        <div className="flex items-center justify-between pt-1 text-sm">
          <button
            type="button"
            onClick={() => setUseBackup((v) => !v)}
            className="text-muted transition-colors hover:text-accent"
          >
            {useBackup ? "改用验证器验证码" : "使用备用码"}
          </button>
          {/*
            A full document reload, not a <Link>. `useActionState` has no
            setter, so the only way back to the credentials step is to throw
            away the component's state entirely — and a client-side navigation
            to the same route would keep the same component instance and with
            it the half-finished challenge. The button says what it means.
          */}
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="text-faint transition-colors hover:text-accent"
          >
            重新登录
          </button>
        </div>
      </form>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-foreground">
          邮箱
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoFocus
          autoComplete="username"
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-foreground">
          密码
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className={inputClass}
        />
      </div>

      {state.error && <p className="text-sm text-red-500">{state.error}</p>}

      <SubmitButton pending={pending}>{pending ? "登录中…" : "登录"}</SubmitButton>
    </form>
  );
}

const inputClass =
  "w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-foreground " +
  "placeholder:text-faint transition-colors focus:border-accent focus:outline-none " +
  "focus-visible:ring-2 focus-visible:ring-accent/40";

/**
 * For local development against http rather than https.
 *
 * Cookies marked `Secure` are dropped by the browser on an insecure origin, so
 * the session cookie never arrives and login appears to succeed and then
 * bounces straight back to the form. That failure is confusing enough to be
 * worth an explicit note on the page rather than a comment in the source.
 */
export function InsecureCookieNotice() {
  const flagged =
    typeof window !== "undefined" &&
    window.location.protocol === "http:" &&
    window.location.hostname !== "localhost" &&
    window.location.hostname !== "127.0.0.1";

  if (!flagged) return null;
  return (
    <p className="mt-4 rounded-lg border border-border bg-surface-2 p-3 text-xs text-muted">
      页面通过 http 访问非本地地址，登录 Cookie 会被浏览器丢弃。请使用 https，
      或设置 <code className="font-mono">PROLOGUE_ALLOW_INSECURE_COOKIE=1</code>。
    </p>
  );
}
