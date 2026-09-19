"use client";

import { useState } from "react";

/**
 * A confirmation for something that cannot be undone.
 *
 * ## Why typing is required for the destructive case
 *
 * A dialog with an OK button is dismissed by reflex — the hand is already
 * moving when the brain reads the sentence. Deleting a post takes its entire
 * revision history, its tag links and its search row with it, and there is no
 * undo; the author has to be slowed down enough to read which post they are
 * about to lose. Typing the slug is that pause, and it is the same mechanism
 * `deletePostAction` enforces on the SERVER (`confirmation` must equal the
 * slug), so this dialog is not the only thing standing between a reflex and a
 * cascading delete — a client that skipped it would still be refused.
 *
 * ## Why the consequences are enumerated literally
 *
 * "This cannot be undone" is not information. Counting the revisions and naming
 * the URL is. The numbers come from the caller because it is the only thing
 * that has them, and a dialog that guesses is worse than one that says nothing.
 *
 * ## Why the parent owns the action
 *
 * Same reason as `RenamePageDialog`: the revalidation calls live in the screen
 * that owns the router, so this component takes a `title`, some `consequences`
 * and an `onConfirm`, and knows nothing about posts, pages or storage.
 */
export function ConfirmDialog({
  title,
  intro,
  consequences = [],
  confirmLabel = "删除",
  /** When set, the author must type this exactly. */
  confirmWord,
  /** Shown as the input's prefix, so the typed value reads as what it is. */
  confirmPrefix = "",
  pending: externalPending = false,
  onConfirm,
  onClose,
}) {
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  const busy = pending || externalPending;
  const needsWord = Boolean(confirmWord);
  const ready = !needsWord || typed.trim() === confirmWord;

  async function submit(e) {
    e.preventDefault();
    if (!ready || busy) return;

    setPending(true);
    setError(null);
    try {
      const result = await onConfirm(typed.trim());
      if (result?.ok) onClose(result);
      else {
        setError(result?.message ?? confirmProblem(result?.reason));
        setPending(false);
      }
    } catch (err) {
      setError(err?.message ?? "操作失败");
      setPending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={() => !busy && onClose()}
      role="presentation"
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        // `max-h` + `overflow-y-auto`, and `dvh` rather than `vh`.
        //
        // A dialog anchored to the bottom of a phone screen with no height cap
        // is a dialog whose confirm button the soft keyboard covers. iOS does
        // not resize the LAYOUT viewport for the keyboard, so `fixed inset-0`
        // keeps its full height, everything below y≈376 is hidden, and nothing
        // scrolls because the container has no scrollable content — the author
        // sees a typed confirmation field and no way to reach 永久删除.
        //
        // `dvh` and not `vh` for the same reason a browser toolbar retracting
        // should not move the cap: `vh` is the LARGE viewport, so `90vh` is
        // taller than the screen whenever browser chrome is showing, which is
        // exactly when the field is covered.
        className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-border bg-surface p-4 sm:rounded-2xl"
      >
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {intro && <p className="mt-1 text-xs leading-5 text-muted">{intro}</p>}

        {consequences.length > 0 && (
          <ul className="mt-3 space-y-1 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-[11px] leading-5 text-muted">
            {consequences.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}

        {needsWord && (
          <>
            <label
              htmlFor="confirm-word"
              className="mt-4 mb-1 block text-xs font-medium text-muted"
            >
              输入 <span className="font-mono text-foreground">{confirmWord}</span> 以确认
            </label>
            <div className="flex items-center gap-1">
              {confirmPrefix && (
                <span className="font-mono text-sm text-faint">{confirmPrefix}</span>
              )}
              <input
                id="confirm-word"
                type="text"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoFocus
                autoComplete="off"
                spellCheck={false}
                className={`${input} font-mono`}
              />
            </div>
          </>
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
            disabled={busy}
            className={buttonGhost}
          >
            取消
          </button>
          <button
            type="submit"
            disabled={!ready || busy}
            className="btn-danger rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-40"
          >
            {busy ? "处理中…" : confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

function confirmProblem(reason) {
  switch (reason) {
    case "confirmation_mismatch":
      return "确认文字与内容不符，没有删除。";
    case "not_found":
      return "内容不存在，可能已被删除。";
    case "not_published":
      return "这项目前不是已发布状态。";
    default:
      return "操作失败，请重试。";
  }
}

const buttonGhost =
  "rounded-lg border border-border px-3 py-1.5 text-xs text-muted transition-colors " +
  "hover:bg-surface-2 hover:text-accent disabled:opacity-50";

const input =
  "w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-foreground " +
  "placeholder:text-faint transition-colors focus:border-accent focus:outline-none " +
  "focus-visible:ring-2 focus-visible:ring-accent/40";
