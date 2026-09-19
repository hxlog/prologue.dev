"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { deleteRedirectAction, saveRedirectAction } from "../../actions/settings";
import { IconPlus } from "../../../../components/studio/icons";

/**
 * The redirect table.
 *
 * Retired URLs that still forward somewhere. Most of the rows here are written
 * automatically — renaming a page or a tag leaves one behind — so this screen
 * exists for the two things that cannot be automatic: looking at what has been
 * retired, and adding a redirect by hand for a URL that never lived in this
 * database.
 *
 * ## The `hits` column, and what it does not mean
 *
 * It counts RENDERS, not requests: the redirect is resolved inside a route
 * whose output is cached, so a reader served from cache is not counted. That is
 * written down in src/lib/studio/redirects.js and on the column itself, and it
 * is repeated here because the header of a table is where a number gets
 * believed. What it answers is "is anything still arriving here at all"; an
 * entry with zero hits after a rename is a candidate for deletion, and an entry
 * still climbing is one somebody still links to. It is not traffic.
 */
export default function RedirectsPanel({ initial }) {
  const router = useRouter();

  const [rows, setRows] = useState(initial);
  const [draft, setDraft] = useState({ source: "", destination: "" });
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  function add(e) {
    e.preventDefault();
    const source = draft.source.trim();
    const destination = draft.destination.trim();
    if (!source || !destination) return;

    setError(null);
    const work = saveRedirectAction(source, destination);
    startTransition(async () => {
      const result = await work;
      if (result.ok) {
        setDraft({ source: "", destination: "" });
        router.refresh();
      } else {
        setError("无法创建：地址必须是路径，且不能与目标相同。");
      }
    });
  }

  function remove(source) {
    startTransition(async () => {
      const result = await deleteRedirectAction(source);
      if (result.ok) {
        setRows(rows.filter((r) => r.source !== source));
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface px-4 py-10 text-center text-sm text-faint">
          还没有任何跳转。重命名页面或标签时会自动创建。
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-faint">
                <th className="px-3 py-2 font-medium">旧地址</th>
                <th className="px-3 py-2 font-medium">跳到</th>
                <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">
                  渲染次数
                </th>
                <th className="w-10 px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <tr key={row.source}>
                  <td className="max-w-0 px-3 py-2">
                    <span className="block truncate font-mono text-xs text-foreground">
                      {row.source}
                    </span>
                  </td>
                  <td className="max-w-0 px-3 py-2">
                    <span className="block truncate font-mono text-xs text-muted">
                      {row.destination}
                    </span>
                    {!row.permanent && (
                      <span className="text-[11px] text-faint">临时（307）</span>
                    )}
                  </td>
                  <td className="hidden px-3 py-2 text-right text-xs tabular-nums text-faint sm:table-cell">
                    {row.hits}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => remove(row.source)}
                      aria-label={`删除 ${row.source}`}
                      className="text-xs text-faint transition-colors hover:text-danger disabled:opacity-40"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form onSubmit={add} className="rounded-xl border border-border bg-surface p-3">
        <p className="mb-2 text-xs font-medium text-muted">手动添加跳转</p>
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input
            type="text"
            value={draft.source}
            onChange={(e) => setDraft({ ...draft, source: e.target.value })}
            placeholder="/old-path"
            aria-label="旧地址"
            className={`${input} font-mono text-xs`}
          />
          <input
            type="text"
            value={draft.destination}
            onChange={(e) => setDraft({ ...draft, destination: e.target.value })}
            placeholder="/new-path"
            aria-label="目标地址"
            className={`${input} font-mono text-xs`}
          />
          <button
            type="submit"
            disabled={pending || !draft.source.trim() || !draft.destination.trim()}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium btn-brand disabled:opacity-40"
          >
            <IconPlus className="h-4 w-4" />
            添加
          </button>
        </div>
        <p className="mt-2 text-[11px] leading-5 text-faint">
          只匹配完整路径，不支持通配符。前缀规则写在 next.config.js 中。
        </p>
      </form>
    </div>
  );
}

const input =
  "w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-foreground " +
  "placeholder:text-faint transition-colors focus:border-accent focus:outline-none " +
  "focus-visible:ring-2 focus-visible:ring-accent/40";
