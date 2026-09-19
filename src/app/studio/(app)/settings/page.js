import { requireUser } from "../../../../lib/auth/require";
import { listSessions } from "../../../../lib/auth/session-store";
import { getTotpState } from "../../../../lib/auth/totp-settings";
import { countUnusedBackupCodes } from "../../../../lib/auth/backup-codes";
import { listRedirects } from "../../../../lib/studio/redirects";
import { AccountPanel } from "./account-panel";
import SessionsPanel from "./sessions-panel";
import RedirectsPanel from "./redirects-panel";

/**
 * Settings: the account, the second factor, and the devices signed in.
 *
 * Everything here is about the ONE account that exists. There is no user list
 * and no registration, which is why this screen is a set of panels about trust
 * — password, second factor, sessions — rather than a CRUD table.
 *
 * ## Read uncached, on purpose
 *
 * The session list and the TOTP state are the two values on this page that go
 * stale in ways that matter: "剩余备用码 3 个" is wrong the moment one is used
 * to sign in, and a device list that does not include the device you just
 * signed in on is worse than no list. Both are single-row reads for one
 * authenticated person, so the cost of not caching them is a query nobody will
 * ever see.
 *
 * A blocking route (`instant = false`) because it reads a session. That is also
 * why the redirect in `requireUser` works as a real 307 here rather than being
 * baked into a shell — there is no static shell to bake.
 */
export const metadata = { title: "设置" };
export const instant = false;

export default async function SettingsPage() {
  const session = await requireUser();

  const [sessions, totp, unusedBackupCodes, redirects] = await Promise.all([
    listSessions(session.user.id),
    getTotpState(session.user.id),
    countUnusedBackupCodes(session.user.id),
    listRedirects(),
  ]);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold tracking-tight text-foreground">设置</h1>
        <p className="mt-1 text-xs text-faint">
          账号、两步验证与登录设备
        </p>
      </header>

      <AccountPanel
        account={{ email: session.user.email, name: session.user.name }}
        totp={{ ...totp, unusedBackupCodes }}
      />

      <section className="rounded-xl border border-border bg-surface">
        <div className="flex items-baseline justify-between border-b border-border px-3 py-2">
          <h2 className="text-xs font-medium text-muted">登录设备</h2>
          <span className="text-[11px] text-faint">{sessions.length} 个活跃会话</span>
        </div>
        <div className="p-3">
          <SessionsPanel sessions={sessions} currentId={session.sessionId} />
        </div>
      </section>

      <section className="rounded-xl border border-border bg-surface">
        <div className="flex items-baseline justify-between border-b border-border px-3 py-2">
          <h2 className="text-xs font-medium text-muted">跳转</h2>
          <span className="text-[11px] text-faint">
            {redirects.length} 条 · 重命名页面或标签时自动创建
          </span>
        </div>
        <div className="p-3">
          <RedirectsPanel initial={redirects} />
        </div>
      </section>
    </div>
  );
}
