import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth/sessions";
import SignInForm, { InsecureCookieNotice } from "./sign-in-form";

/**
 * Blocking, not streamed.
 *
 * The default under `cacheComponents` is to stream: render a shell immediately
 * and fill in anything that reads `cookies()` behind a `<Suspense>` boundary.
 * That is the wrong shape for this page. The cookie *decides what the page is*
 * — a signed-in visitor must be redirected to the dashboard, not shown a login
 * form that flashes and is then replaced by a navigation. There is nothing
 * useful to show in the meantime, and the alternative is a visible flicker on
 * every return visit.
 *
 * `instant = false` is the way to say that; `export const dynamic` is an error
 * under cacheComponents.
 */
export const instant = false;

export const metadata = {
  title: "登录 · Prologue Studio",
  // Belt and braces with the root layout's site-wide robots rule: a login form
  // is the one page that must never be indexed under any circumstance, even if
  // someone later narrows the root rule.
  robots: { index: false, follow: false },
};

/**
 * The sign-in page.
 *
 * A Server Component that renders a Client Component form. It reads the
 * session only to bounce an already-signed-in visitor straight to the
 * dashboard — someone who bookmarked /studio/login should not have to sign in
 * twice.
 *
 * `getSession()` reads a cookie, which is request-time data. That is legal
 * here because `cacheComponents` only forbids *caching* a route that reads
 * cookies without declaring it; reading them is exactly what makes this route
 * dynamic, and a login page has no business being prerendered.
 */
export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect("/studio");

  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div
            aria-hidden="true"
            className="mx-auto mb-4 h-11 w-11 rounded-xl"
            style={{ background: "var(--gradient-brand)" }}
          />
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            Prologue Studio
          </h1>
          <p className="mt-1.5 text-sm text-muted">登录以管理站点内容</p>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
          <SignInForm />
        </div>

        <InsecureCookieNotice />

        <p className="mt-6 text-center text-xs text-faint">
          本站仅有作者一个账号，不提供注册。
        </p>
      </div>
    </div>
  );
}
