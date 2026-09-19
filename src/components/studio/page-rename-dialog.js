"use client";

import { useState } from "react";

/**
 * Rename a page's path.
 *
 * A dialog rather than an inline field, because a page's slug is a URL people
 * type and other pages link to. The confirmation states both consequences
 * plainly — the old path gets a permanent redirect and the nav entry moves with
 * it — so that pressing the button is an informed act rather than a guess.
 *
 * ## The preview of what will happen
 *
 * Rendered from the typed value as it changes, not as a static paragraph. The
 * interesting part of a rename is not "a redirect will be created" — it is
 * *which* URL now points *where*, and that is only useful if it is spelled out
 * with the author's actual input in it.
 *
 * ## Why the parent owns the action
 *
 * This component never calls the server itself; it calls `onRename` and reports
 * the result. That keeps the revalidation calls in one place — the editor,
 * which also owns the cache tags and the router — and makes the dialog testable
 * by rendering it with a stub.
 */
export function RenamePageDialog({ slug, onClose, onRename }) {
  const [next, setNext] = useState(slug);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  const clean = next.trim().replace(/^\/+/, "");
  const changed = clean !== "" && clean !== slug;

  async function submit(e) {
    e.preventDefault();
    if (!changed || pending) return;

    setPending(true);
    setError(null);
    try {
      const result = await onRename(clean);
      if (result?.ok) onClose(result);
      else {
        setError(renameProblem(result?.reason));
        setPending(false);
      }
    } catch (err) {
      setError(err?.message ?? "重命名失败");
      setPending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={() => !pending && onClose()}
      role="presentation"
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-t-2xl border border-border bg-surface p-4 sm:rounded-2xl"
      >
        <h2 className="text-sm font-semibold text-foreground">修改页面路径</h2>
        <p className="mt-1 text-xs text-muted">
          页面路径是读者直接输入的网址，也可能是其他页面引用的链接。
        </p>

        <label
          htmlFor="rename-input"
          className="mt-4 mb-1 block text-xs font-medium text-muted"
        >
          新路径
        </label>
        <div className="flex items-center gap-1">
          <span className="font-mono text-sm text-faint">/</span>
          <input
            id="rename-input"
            type="text"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoFocus
            className={`${input} font-mono`}
          />
        </div>

        {changed && (
          <div className="mt-3 space-y-1 rounded-lg border border-border bg-surface-2 px-3 py-2 text-[11px] text-muted">
            <p>
              <span className="font-mono text-faint">/{slug}</span> 会永久跳转到{" "}
              <span className="font-mono text-accent">/{clean}</span>
            </p>
            <p>导航栏中的条目会跟着移动。</p>
          </div>
        )}

        {error && (
          <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-500">
            {error}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onClose()}
            disabled={pending}
            className={buttonGhost}
          >
            取消
          </button>
          <button
            type="submit"
            disabled={!changed || pending}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {pending ? "处理中…" : "重命名"}
          </button>
        </div>
      </form>
    </div>
  );
}

function renameProblem(reason) {
  switch (reason) {
    case "duplicate":
      return "已经有页面使用了这个路径。";
    case "invalid":
      return "路径不能为空，且不能与当前路径相同。";
    case "not_found":
      return "页面不存在，可能已被删除。";
    default:
      return "重命名失败，请重试。";
  }
}

const buttonGhost =
  "rounded-lg border border-border px-3 py-1.5 text-xs text-muted transition-colors " +
  "hover:bg-surface-2 hover:text-accent disabled:opacity-50";

const input =
  "w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-foreground " +
  "placeholder:text-faint transition-colors focus:border-accent focus:outline-none " +
  "focus-visible:ring-2 focus-visible:ring-accent/40";
