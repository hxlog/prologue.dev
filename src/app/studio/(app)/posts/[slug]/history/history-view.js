"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { diffRevisions, restoreRevisionAction } from "../../../../actions/posts";
import { IconHistory, IconWarning } from "../../../../../../components/studio/icons";

/**
 * The history screen's interactive half.
 *
 * Two things live here and nothing else: which pair of revisions is being
 * compared, and the restore confirmation. Everything that could be computed on
 * the server was — see the page — which is why this component receives a ready
 * diff rather than two documents.
 *
 * ## The diff
 *
 * Server-computed and returned as rows, so the browser never receives more than
 * the changed lines plus their context. A 24 KB post diffed against itself with
 * one word changed is a handful of rows; shipping both documents to compute
 * that in the browser would send roughly a thousand times more data.
 *
 * ## Restore is a copy, not a pointer move
 *
 * The button says so, because it is the one thing about this screen a person
 * could reasonably get wrong. Restoring does not "go back" — it creates a NEW
 * revision whose content matches the old one. The old one is still there
 * afterwards, and so is everything between. That is what makes restore safe to
 * use: an author who restores the wrong version can restore forward again.
 */
export default function HistoryView({
  slug,
  revisions,
  initial,
  currentRevisionId,
  publishedRevisionId,
}) {
  const router = useRouter();

  const [fromId, setFromId] = useState(initial?.fromId ?? "");
  const [toId, setToId] = useState(initial?.toId ?? "");
  const [diff, setDiff] = useState(initial?.diff ?? null);
  const [pending, startTransition] = useTransition();
  const [restoring, setRestoring] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const canCompare = fromId && toId && fromId !== toId;

  function compare(nextFrom = fromId, nextTo = toId) {
    if (!nextFrom || !nextTo || nextFrom === nextTo) {
      setDiff(null);
      return;
    }
    startTransition(async () => {
      const result = await diffRevisions(slug, nextFrom, nextTo);
      if (result.ok) {
        setDiff(result.diff);
        setError(null);
      } else {
        setError("无法比较这两个版本。");
      }
    });
  }

  function restore(revisionId, revisionNumber) {
    setRestoring(revisionId);
    setError(null);
    setNotice(null);

    startTransition(async () => {
      const result = await restoreRevisionAction(slug, revisionId);
      setRestoring(null);

      if (result.ok) {
        setNotice(
          `已从 r${result.restoredFrom} 恢复，创建了 r${result.revisionNumber}。` +
            " 返回编辑器查看，确认无误后再发布。"
        );
        router.refresh();
      } else {
        setError(restoreProblem(result.reason));
      }
    });
  }

  if (revisions.length === 0) {
    return (
      <p className="rounded-xl border border-border bg-surface px-4 py-12 text-center text-sm text-faint">
        这篇文章还没有任何版本。
      </p>
    );
  }

  return (
    <div className="space-y-4">
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

      <div className="grid gap-4 lg:grid-cols-[20rem_1fr] lg:items-start">
        {/* ── the list ─────────────────────────────────────────────── */}
        <section className="rounded-xl border border-border bg-surface">
          <div className="border-b border-border px-3 py-2">
            <span className="text-xs font-medium text-muted">版本</span>
          </div>
          <ul className="max-h-[70vh] divide-y divide-border overflow-y-auto">
            {revisions.map((rev) => (
              <RevisionRow
                key={rev.id}
                revision={rev}
                isCurrent={rev.id === currentRevisionId}
                isPublished={rev.id === publishedRevisionId}
                restoring={restoring === rev.id}
                onRestore={() => restore(rev.id, rev.revision_number)}
              />
            ))}
          </ul>
        </section>

        {/* ── the diff ─────────────────────────────────────────────── */}
        <section className="min-w-0 rounded-xl border border-border bg-surface">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
            <select
              value={fromId}
              onChange={(e) => {
                setFromId(e.target.value);
                compare(e.target.value, toId);
              }}
              aria-label="起始版本"
              className={select}
            >
              {revisions.map((r) => (
                <option key={r.id} value={r.id}>
                  r{r.revision_number} · {label(r)}
                </option>
              ))}
            </select>

            <span className="text-xs text-faint">→</span>

            <select
              value={toId}
              onChange={(e) => {
                setToId(e.target.value);
                compare(fromId, e.target.value);
              }}
              aria-label="目标版本"
              className={select}
            >
              {revisions.map((r) => (
                <option key={r.id} value={r.id}>
                  r{r.revision_number} · {label(r)}
                </option>
              ))}
            </select>

            {pending && <span className="text-xs text-faint">计算中…</span>}
          </div>

          <DiffBody diff={diff} canCompare={canCompare} />
        </section>
      </div>
    </div>
  );
}

function RevisionRow({ revision, isCurrent, isPublished, restoring, onRestore }) {
  return (
    <li className="px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="font-mono text-muted">r{revision.revision_number}</span>
            {isPublished && (
              <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent">
                已发布
              </span>
            )}
            {isCurrent && !isPublished && (
              <span className="rounded-full bg-surface-3 px-1.5 py-0.5 text-[10px] font-medium text-muted">
                当前草稿
              </span>
            )}
          </p>
          <p className="mt-1 truncate text-xs text-foreground" title={revision.title}>
            {revision.title || "未命名"}
          </p>
          <p className="mt-0.5 text-[11px] text-faint">
            {absoluteTime(revision.created_at)} · {bytes(revision.markdown_bytes)}
          </p>
          {revision.change_summary && (
            <p className="mt-1 text-[11px] italic text-muted">{revision.change_summary}</p>
          )}
        </div>

        {!isCurrent && (
          <button
            type="button"
            onClick={onRestore}
            disabled={restoring}
            className="shrink-0 rounded-lg border border-border px-2 py-1 text-[11px] text-muted transition-colors hover:bg-surface-2 hover:text-accent disabled:opacity-50"
          >
            {restoring ? "恢复中…" : "恢复"}
          </button>
        )}
      </div>
    </li>
  );
}

function DiffBody({ diff, canCompare }) {
  if (!canCompare) {
    return (
      <p className="flex items-start gap-2 px-4 py-10 text-center text-sm text-faint">
        <IconHistory className="mt-0.5 h-4 w-4 shrink-0" />
        <span>选择一个版本与另一个版本比较。</span>
      </p>
    );
  }

  if (!diff) {
    return <p className="px-4 py-10 text-center text-sm text-faint">计算中…</p>;
  }

  if (diff.truncated) {
    return (
      <p className="flex items-start gap-2 px-4 py-8 text-sm text-muted">
        <IconWarning className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
        <span>{diff.rows[0]?.text ?? "文档过大，无法逐行比较。"}</span>
      </p>
    );
  }

  if (diff.identical) {
    return (
      <p className="px-4 py-10 text-center text-sm text-faint">
        这两个版本的内容完全相同。
      </p>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-3 py-2 text-xs">
        <span className="text-accent">+{diff.stats.added}</span>
        <span className="text-danger">−{diff.stats.removed}</span>
        {diff.stats.moved > 0 && (
          <span className="text-warn">
            ⇄ {diff.stats.moved} 行移动
          </span>
        )}
      </div>

      {/*
        A <table>, not a grid of divs. A diff is tabular data — line numbers on
        both sides, one row per line — and a table is the only structure a
        screen reader will read as "row 12, old line 8, new line 9".

        `whitespace-pre-wrap` rather than `pre`: markdown lines are long and a
        horizontal scrollbar across a diff is the fastest way to make one
        unreadable on a phone.
      */}
      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full border-collapse font-mono text-[12px] leading-6">
          <tbody>
            {diff.rows.map((row, i) => (
              <tr key={i} className={rowClass(row.type, row.moved)}>
                <td className="w-10 select-none border-r border-border px-2 text-right align-top text-faint">
                  {row.beforeLine ?? ""}
                </td>
                <td className="w-10 select-none border-r border-border px-2 text-right align-top text-faint">
                  {row.afterLine ?? ""}
                </td>
                <td className="w-4 select-none px-1 text-center align-top text-faint">
                  {marker(row.type)}
                </td>
                <td className="whitespace-pre-wrap break-all px-2 align-top">
                  {row.text || " "}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function marker(type) {
  if (type === "add") return "+";
  if (type === "remove") return "−";
  return "";
}

function rowClass(type, moved) {
  // Moved lines get their own colour rather than add/remove. A block that was
  // relocated reads as one deletion and one insertion, and two identical lines
  // marked "changed" in different places reads as a broken diff — so saying
  // "moved" is the honest answer, and it is only honest because the module
  // proves both sides exist before claiming it.
  if (moved) return "bg-warn-soft text-warn";
  if (type === "add") return "bg-accent-soft text-accent-strong dark:text-accent";
  if (type === "remove") return "bg-danger-soft text-danger dark:text-danger";
  if (type === "gap")
    return "bg-surface-2 text-[11px] italic text-faint";
  return "text-muted";
}

function label(revision) {
  return `${absoluteTime(revision.created_at)}`;
}

function absoluteTime(value) {
  if (!value) return "";
  const d = new Date(value);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function bytes(n) {
  if (!n) return "0 B";
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KB`;
}

function restoreProblem(reason) {
  switch (reason) {
    case "not_found":
      return "该版本不存在。";
    default:
      return "恢复失败，请重试。";
  }
}

const select =
  "rounded-lg border border-border bg-surface-2 px-2 py-1 text-xs text-foreground " +
  "transition-colors focus:border-accent focus:outline-none";
