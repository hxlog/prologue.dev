"use client";

import { useState } from "react";

/**
 * Rename a post's slug.
 *
 * Deliberately a near-copy of `RenamePageDialog` rather than a shared
 * component. The two are the same SHAPE and differ in every sentence: a page's
 * path is typed by readers and sits in the nav, a post's path is its identity
 * in three feeds, in every inbound link, and in the GUID every RSS reader has
 * already stored. A shared component would need the differences passed in as
 * strings, and the strings are the part worth writing carefully.
 *
 * ## Why the consequences are spelled out
 *
 * Renaming a post does three things a reader notices: the old URL starts
 * redirecting, the "view on GitHub" link at the foot of the page is built from
 * the source path and does not change, and every feed's `<link>` moves while
 * its `<guid>` — which is the slug — also moves, so an aggregator that has
 * seen the post will show it again. That last one is not obvious and is exactly
 * what the author should know before pressing the button.
 */
export function PostRenameDialog({ slug, published, onClose, onRename }) {
  const [next, setNext] = useState(slug);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  // Slugs are lowercased everywhere — route matching depends on it — and the
  // preview shows the normalised form so the author is not surprised by it.
  const clean = next.trim().toLowerCase().replace(/^\/+/, "").replace(/\s+/g, "-");
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
        <h2 className="text-sm font-semibold text-foreground">修改文章路径</h2>
        <p className="mt-1 text-xs leading-5 text-muted">
          文章路径是读者的网址，也是订阅源里的链接。路径一旦被读者订阅过，改动就会
          让聚合器把那篇文章当作新内容再显示一次。
        </p>

        <label
          htmlFor="rename-post"
          className="mt-4 mb-1 block text-xs font-medium text-muted"
        >
          新路径
        </label>
        <div className="flex items-center gap-1">
          <span className="font-mono text-sm text-faint">/blog/</span>
          <input
            id="rename-post"
            type="text"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            className={`${input} font-mono`}
          />
        </div>

        {changed && (
          <div className="mt-3 space-y-1 rounded-lg border border-border bg-surface-2 px-3 py-2 text-[11px] leading-5 text-muted">
            <p>
              <span className="font-mono text-faint">/blog/{slug}</span> 会永久跳转到{" "}
              <span className="font-mono text-accent">/blog/{clean}</span>
            </p>
            {published && (
              <p>已发布的文章改路径后，订阅源里的链接会指向新地址。</p>
            )}
          </div>
        )}

        {error && (
          <p className="mt-3 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
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
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium btn-brand disabled:opacity-40"
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
      return "已经有文章使用了这个路径。";
    case "invalid":
      return "路径不能为空，且不能与当前路径相同。";
    case "not_found":
      return "文章不存在，可能已被删除。";
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
