"use client";

import { useEffect, useRef, useState } from "react";

import { listMediaAction } from "../../app/studio/actions/media";
import { mediaUrl } from "../../lib/media/paths";
import { useMediaUpload } from "./use-media-upload";
import { IconClose, IconPlus, IconSearch } from "./icons";

/**
 * The library, as a picker inside an editor.
 *
 * ## Why it is a dialog and not a page
 *
 * The author is writing. Sending them to `/studio/media` and back would lose the
 * caret, the undo history and the scroll position — and a library that cannot
 * answer "this one" without an excursion is a library the author stops opening.
 * So this is the same three-step upload pipeline as the full screen, reached
 * without leaving the document.
 *
 * ## The one thing it does to the document
 *
 * `onPick` receives markdown and the caller inserts it at the caret. The picker
 * does not know whether its caller is the post editor, the page editor, a
 * collection's markdown field or the cover-image input — those want different
 * things from the same grid. Keeping the insertion on the caller's side is what
 * lets one component serve all of them; see `insertMarkdown` in the CodeMirror
 * component for the other half.
 *
 * ## Failure is a state, not a toast
 *
 * `blobConfigured()` is checked on the server before the screen renders, and
 * when the store is unconfigured the panel says so. A local checkout with no
 * token is a normal state, not a bug, and an upload button that silently does
 * nothing is the worst possible way to communicate it.
 */
export function MediaPicker({ open, onClose, onPick, configured = true }) {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState("");
  // `loaded` rather than a loading flag for the first read: it starts false and
  // the render treats that as "reading", so nothing has to be set before the
  // first await. `loading` is for the search button, which is a later event.
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [notice, setNotice] = useState(null);
  const fileInput = useRef(null);
  const { upload, uploads } = useMediaUpload();

  async function load(term) {
    setLoading(true);
    setNotice(null);
    try {
      const result = await listMediaAction({ query: term, limit: 100 });
      if (result?.ok) setItems(result.media);
      else setNotice("无法读取媒体库。");
    } catch (err) {
      setNotice(err?.message ?? "无法读取媒体库。");
    } finally {
      setLoading(false);
    }
  }

  /**
   * Reloaded on open rather than kept in sync.
   *
   * The library changes only when this screen changes it, and a dialog's
   * contents going stale between two openings is not a state anybody has been
   * in.
   *
   * The fetch runs inside an async IIFE and writes state only AFTER the await,
   * never in the effect body — a synchronous `setState` in an effect triggers a
   * second render pass before the first is painted, which React's lint rule
   * rejects and which is a real cost on every open. The `cancelled` flag is what
   * stops a dialog closed mid-request from writing state after it is gone.
   *
   * Nothing is set to "loading" up front: `loaded` starts false and the render
   * below treats that as loading, so the first paint is already correct.
   */
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    (async () => {
      try {
        const result = await listMediaAction({ query: "", limit: 100 });
        if (cancelled) return;
        if (result?.ok) setItems(result.media);
        else setNotice("无法读取媒体库。");
      } catch (err) {
        if (!cancelled) setNotice(err?.message ?? "无法读取媒体库。");
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function handleFiles(files) {
    const incoming = Array.from(files ?? []).filter((f) => f.type.startsWith("image/"));
    if (!incoming.length) {
      setNotice("只支持图片文件。");
      return;
    }

    for (const file of incoming) {
      const media = await upload(file);
      if (media) setItems((all) => [media, ...all]);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={onClose}
      role="presentation"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="媒体库"
        className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-t-2xl border border-border bg-surface sm:rounded-2xl"
      >
        <header className="flex items-center gap-2 border-b border-border px-3 py-2">
          <h2 className="text-sm font-semibold text-foreground">媒体库</h2>
          {configured && (
            <span className="text-[11px] text-faint">
              拖入或选择图片，上传后点击插入
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭媒体库"
            className="ml-auto flex h-7 w-7 items-center justify-center rounded-full text-faint transition-colors hover:bg-surface-3 hover:text-foreground"
          >
            <IconClose className="h-4 w-4" />
          </button>
        </header>

        {!configured ? (
          <p className="px-3 py-6 text-center text-xs leading-6 text-muted">
            未配置 Blob 存储。在 <span className="font-mono">.env.local</span> 中填入{" "}
            <span className="font-mono">BLOB_READ_WRITE_TOKEN</span> 后重启开发服务器。
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
              <label className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2 py-1.5">
                <IconSearch className="h-3.5 w-3.5 shrink-0 text-faint" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && load(search)}
                  placeholder="按文件名、alt 或说明搜索"
                  aria-label="搜索媒体库"
                  className="min-w-0 flex-1 bg-transparent text-xs text-foreground placeholder:text-faint focus:outline-none"
                />
              </label>
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
                style={{ background: "var(--gradient-brand)" }}
              >
                <IconPlus className="h-3.5 w-3.5" />
                上传
              </button>
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => {
                  handleFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>

            {notice && (
              <p className="border-b border-border bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-500">
                {notice}
              </p>
            )}

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                handleFiles(e.dataTransfer.files);
              }}
              className={`min-h-[12rem] flex-1 overflow-y-auto p-3 ${
                dragOver ? "bg-accent-soft/40" : ""
              }`}
            >
              {uploads.length > 0 && (
                <ul className="mb-3 space-y-1">
                  {uploads.map((u) => (
                    <li key={u.id} className="text-[11px] text-muted">
                      {u.name} ·{" "}
                      {u.status === "failed"
                        ? `失败：${u.error}`
                        : u.status === "uploading"
                          ? "上传中…"
                          : u.status === "committing"
                            ? "写入…"
                            : "准备…"}
                    </li>
                  ))}
                </ul>
              )}

              {!loaded ? (
                <p className="py-8 text-center text-xs text-faint">读取中…</p>
              ) : items.length === 0 ? (
                <p className="py-8 text-center text-xs text-faint">
                  {search ? "没有匹配的图片。" : "媒体库还是空的。上传第一张图片。"}
                </p>
              ) : (
                <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                  {items.map((m) => (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => onPick(m)}
                        title={m.original_name ?? m.pathname}
                        className="group block w-full overflow-hidden rounded-lg border border-border bg-surface-2 text-left transition-colors hover:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                      >
                        {/*
                          A plain <img>, not next/image. These are admin
                          thumbnails behind a session: the optimiser would fetch
                          them through /api/img with no cookie and get a 404 for
                          anything unpublished, which is half the library. The
                          browser's own lazy loading is enough for a grid this
                          size.
                        */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={mediaUrl(m.pathname)}
                          alt={m.alt ?? ""}
                          loading="lazy"
                          className="aspect-4/3 w-full object-cover"
                        />
                        <span className="block truncate px-2 py-1 text-[10px] text-faint group-hover:text-accent">
                          {m.original_name || m.pathname.split("/").pop()}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
