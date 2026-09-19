"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  endOtherSessionsAction,
  endSessionAction,
} from "../../actions/settings";
import { IconClose } from "../../../../components/studio/icons";

/**
 * The signing-in devices.
 *
 * A session row is a browser that can reach the studio without a password, so
 * this list is the answer to "is anyone else signed in" — which is the question
 * someone arrives with after a scare, not after a routine check.
 *
 * ## What is rendered and what is not
 *
 * `user_agent` and `ip` arrive in HTTP headers, which means they are
 * attacker-controlled strings. They are shown, because a device list without
 * them is a list of dates, but they are rendered as TEXT through React's
 * escaping and never as markup, and the raw agent string is summarised rather
 * than printed: a hundred-character User-Agent in a table cell is unreadable and
 * is also the shape of a header-injection payload.
 *
 * ## Why the current session has no button
 *
 * There is one sign-out control, in the rail. A per-row "sign out" that could
 * end the session you are standing in would look identical to the ones that do
 * not, and the next thing you would see is the login page with no idea which
 * button did it. The server refuses it too — see `endSessionAction` — so the
 * UI and the API agree.
 */
export default function SessionsPanel({ sessions: initial, currentId }) {
  const router = useRouter();
  const [sessions, setSessions] = useState(initial);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [pending, startTransition] = useTransition();

  function end(sessionId) {
    setBusyId(sessionId);
    setError(null);
    setNotice(null);

    startTransition(async () => {
      const result = await endSessionAction(sessionId);
      setBusyId(null);

      if (result.ok) {
        setSessions(sessions.filter((s) => s.id !== sessionId));
        setNotice("已注销该设备。");
        router.refresh();
      } else {
        setError(result.reason === "current" ? "不能注销当前设备。" : "找不到这个会话。");
      }
    });
  }

  function endOthers() {
    if (!window.confirm("注销其他所有设备？当前浏览器会保持登录。")) return;
    setBusyId("others");
    setError(null);
    setNotice(null);

    startTransition(async () => {
      const result = await endOtherSessionsAction();
      setBusyId(null);

      if (result.ok) {
        setSessions(sessions.filter((s) => s.id === currentId));
        setNotice("其他设备已全部注销。");
        router.refresh();
      } else {
        setError("操作失败，请重试。");
      }
    });
  }

  const others = sessions.filter((s) => s.id !== currentId).length;

  return (
    <div className="space-y-3">
      {error && (
        <p className="rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-xl border border-accent/30 bg-accent-soft px-4 py-3 text-sm text-accent">
          {notice}
        </p>
      )}

      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
        {sessions.map((session) => {
          const current = session.id === currentId;
          return (
            <li key={session.id} className="flex items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline gap-2 text-sm text-foreground">
                  {describeAgent(session.userAgent)}
                  {current && (
                    <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
                      当前
                    </span>
                  )}
                </p>
                <p className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-faint">
                  {session.ip && <span className="font-mono">{session.ip}</span>}
                  <span>最近使用 {relative(session.lastUsedAt)}</span>
                  <span>过期 {relative(session.expiresAt)}</span>
                </p>
              </div>

              {!current && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => end(session.id)}
                  aria-label="注销这个设备"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-faint transition-colors hover:bg-surface-3 hover:text-danger disabled:opacity-40"
                >
                  <IconClose className="h-3.5 w-3.5" />
                </button>
              )}
              {busyId === session.id && <span className="text-[11px] text-faint">注销中…</span>}
            </li>
          );
        })}
      </ul>

      {others > 0 && (
        <button
          type="button"
          onClick={endOthers}
          disabled={pending}
          className="rounded-lg border border-danger/40 px-3 py-2 text-sm text-danger transition-colors hover:bg-danger-soft disabled:opacity-40"
        >
          {busyId === "others" ? "注销中…" : `注销其他 ${others} 个设备`}
        </button>
      )}
    </div>
  );
}

/**
 * A User-Agent, reduced to something a person can read.
 *
 * Deliberately a summary and not the string. The value is what a browser sent —
 * which is to say, anything at all — and the row does not need the version
 * numbers to answer "is this me". Anything unrecognised is reported as
 * "未知设备", which is the honest answer and also the one that does not print
 * an untrusted string into the page.
 */
function describeAgent(value) {
  const ua = String(value ?? "");
  if (!ua) return "未知设备";

  const platform = /iPhone|iPad|iPod/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Macintosh|Mac OS X/.test(ua)
        ? "macOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux/.test(ua)
            ? "Linux"
            : null;

  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : null;

  if (browser && platform) return `${platform} 上的 ${browser}`;
  if (browser) return browser;
  if (platform) return platform;
  return "未知设备";
}

/**
 * A timestamp as "12 分钟前".
 *
 * `Intl.RelativeTimeFormat` rather than arithmetic on strings, and the unit is
 * chosen by magnitude so nothing ever reads "0 天前" for something that happened
 * an hour ago.
 */
function relative(value) {
  if (!value) return "—";
  const delta = new Date(value).getTime() - Date.now();
  const abs = Math.abs(delta);

  const units = [
    ["day", 86_400_000],
    ["hour", 3_600_000],
    ["minute", 60_000],
  ];
  const formatter = new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" });

  for (const [unit, ms] of units) {
    if (abs >= ms) return formatter.format(Math.round(delta / ms), unit);
  }
  return "刚刚";
}
