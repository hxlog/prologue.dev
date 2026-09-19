"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  autosavePost,
  publishPostAction,
  unpublishPostAction,
} from "../../../actions/posts";
import { CodeMirrorEditor } from "../../../../../components/studio/codemirror";
import { MetaPanel } from "../../../../../components/studio/meta-panel";
import { PreviewPane } from "../../../../../components/studio/preview-pane";

/**
 * The editor screen.
 *
 * ## Where the preview comes from
 *
 * Not from a second renderer, and not from a round trip of its own. The
 * autosave response carries the HTML the server just rendered from the same
 * `renderMarkdown` it used to store the revision — so the pane on the right is
 * showing the published artifact, not a close approximation of it. That is the
 * entire reason the editor is a source editor (see docs/editor-decision.md),
 * and a preview fetched from a separate endpoint would quietly undo it by
 * introducing a second path.
 *
 * The cost is that the preview updates when autosave runs, not on every
 * keystroke. Given autosave is 2.5s and rendering a 24 KB document takes single
 * digit milliseconds, that is the right trade — and it means the preview never
 * shows something that has not been saved.
 *
 * ## Why the document lives in React state at all
 *
 * The editor below is UNCONTROLLED: it owns an `EditorView` and only reports
 * changes outward. React state never re-seeds the view, so there is no
 * controlled-component re-render per keystroke. The state here is a mirror for
 * the preview and the save payload, not the source of truth — the `EditorView`
 * is.
 *
 * ## Optimistic concurrency
 *
 * `revision` rides with every save. Two tabs on one post is not hypothetical:
 * the author opens a post, follows a link in the preview, and comes back. The
 * server refuses a write whose base revision it no longer holds, and the client
 * does NOT retry — retrying would overwrite whatever the other tab wrote, which
 * is the exact thing the check exists to prevent.
 */
export default function Editor({ initial, tags }) {
  const router = useRouter();

  const [markdown, setMarkdown] = useState(initial.markdown);
  const [meta, setMeta] = useState(initial.meta);
  const [html, setHtml] = useState(initial.html);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [savedAt, setSavedAt] = useState(null);
  const [revision, setRevision] = useState(initial.revisionNumber);
  const [status, setStatus] = useState(initial.status);
  const [pending, setPending] = useState(false);
  const [mobileTab, setMobileTab] = useState("source");

  // The latest values, readable from the debounced callback without making it a
  // dependency. A `useCallback([markdown, meta])` would recreate the timer
  // handler on every keystroke and restart the debounce forever.
  const latest = useRef({ markdown: initial.markdown, meta: initial.meta });
  const revisionRef = useRef(initial.revisionNumber);
  const timer = useRef(null);
  const inFlight = useRef(false);

  const flush = useCallback(async () => {
    if (inFlight.current) return null;
    inFlight.current = true;
    setSaving(true);

    try {
      const result = await autosavePost(initial.slug, {
        markdown: latest.current.markdown,
        meta: latest.current.meta,
        revision: revisionRef.current,
      });

      if (result.ok) {
        revisionRef.current = result.revisionNumber;
        setRevision(result.revisionNumber);
        setHtml(result.html);
        setDirty(false);
        setError(null);
        setSavedAt(Date.now());
      } else if (result.reason === "conflict") {
        setError(
          "这篇文章在别处被修改了。刷新页面查看最新版本，或直接保存以覆盖它。"
        );
      } else {
        setError(result.message ?? "保存失败");
      }
      return result;
    } catch (err) {
      setError(err?.message ?? "保存失败");
      return null;
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }, [initial.slug]);

  const schedule = useCallback(() => {
    setDirty(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 2500);
  }, [flush]);

  const onMarkdownChange = useCallback(
    (next) => {
      latest.current.markdown = next;
      setMarkdown(next);
      schedule();
    },
    [schedule]
  );

  const onMetaChange = useCallback(
    (next) => {
      latest.current.meta = next;
      setMeta(next);
      schedule();
    },
    [schedule]
  );

  /**
   * Publish, or unpublish.
   *
   * Saves first and then publishes, in that order and as two calls, because the
   * publish path publishes whatever revision the draft pointer names — and if
   * the browser is holding unsaved keystrokes, those keystrokes are not it.
   * Reporting "published" for a document that is one edit behind the screen is
   * the single worst thing a publish button can do.
   */
  const onPublish = useCallback(async () => {
    setPending(true);
    try {
      if (dirty || timer.current) {
        if (timer.current) clearTimeout(timer.current);
        const saved = await flush();
        if (!saved?.ok) return;
      }

      const result =
        status === "published"
          ? await unpublishPostAction(initial.slug)
          : await publishPostAction(initial.slug);

      if (result.ok) {
        setStatus(result.status ?? (status === "published" ? "draft" : "published"));
        setError(null);
        router.refresh();
      } else {
        setError(publishProblem(result.reason));
      }
    } catch (err) {
      setError(err?.message ?? "操作失败");
    } finally {
      setPending(false);
    }
  }, [dirty, flush, initial.slug, router, status]);

  return (
    <div className="flex flex-col">
      <Bar
        slug={initial.slug}
        status={status}
        dirty={dirty}
        saving={saving}
        pending={pending}
        savedAt={savedAt}
        revision={revision}
        error={error}
        onSave={flush}
        onPublish={onPublish}
        onHistory={() => router.push(`/studio/posts/${initial.slug}/history`)}
      />

      <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-start">
        <div
          className={`min-w-0 flex-1 ${mobileTab === "source" ? "block" : "hidden lg:block"}`}
        >
          <MetaPanel
            meta={meta}
            onChange={onMetaChange}
            knownTags={tags}
            slug={initial.slug}
          />
          <CodeMirrorEditor
            initialValue={initial.markdown}
            onChange={onMarkdownChange}
            className="mt-4"
          />
        </div>

        <div
          className={`w-full lg:w-[44%] lg:shrink-0 ${
            mobileTab === "preview" ? "block" : "hidden lg:block"
          }`}
        >
          <PreviewPane html={html} />
        </div>
      </div>

      {/*
        Phone tab bar. Sticky to the bottom rather than fixed: `fixed` would sit
        over the page's last element at every scroll position, and the safe-area
        padding is what keeps it above the home indicator.
      */}
      <div
        className="sticky bottom-0 z-20 -mx-4 mt-4 border-t border-border bg-surface/95 px-4 py-2 backdrop-blur lg:hidden"
        style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
      >
        <div className="flex gap-1 rounded-lg bg-surface-2 p-1">
          {[
            ["source", "Markdown"],
            ["preview", "预览"],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setMobileTab(key)}
              aria-pressed={mobileTab === key}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm transition-colors ${
                mobileTab === key
                  ? "bg-surface font-medium text-foreground shadow-sm"
                  : "text-muted"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Bar({
  slug,
  status,
  dirty,
  saving,
  pending,
  savedAt,
  revision,
  error,
  onSave,
  onPublish,
  onHistory,
}) {
  const published = status === "published";

  return (
    <div className="sticky top-0 z-30 -mx-4 border-b border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate font-mono text-xs text-muted">{slug}</h1>
          <div className="mt-1 flex items-center gap-2 text-xs">
            <span
              className={`rounded-full px-2 py-0.5 font-medium ${
                published
                  ? "bg-accent-soft text-accent"
                  : "bg-surface-3 text-muted"
              }`}
            >
              {published ? "已发布" : "草稿"}
            </span>
            <span className="text-faint">r{revision}</span>
            <SaveState dirty={dirty} saving={saving} savedAt={savedAt} />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onHistory}
            className={buttonGhost}
          >
            历史
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className={buttonGhost}
          >
            保存
          </button>
          <button
            type="button"
            onClick={onPublish}
            disabled={pending || saving}
            style={{ background: "var(--gradient-brand)" }}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {pending ? "处理中…" : published ? "撤回为草稿" : "发布"}
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-500">
          {error}
        </p>
      )}
    </div>
  );
}

const buttonGhost =
  "rounded-lg border border-border px-3 py-1.5 text-xs text-muted transition-colors " +
  "hover:bg-surface-2 hover:text-accent disabled:opacity-50";

/**
 * Four states, not two.
 *
 * "已同步" is the one that matters and the one an obvious implementation
 * misses: after a save the server reports whether the bytes actually changed,
 * and "已保存" for a document nobody edited is noise. It is also the state the
 * author sees most of the time, because autosave fires on a timer.
 */
function SaveState({ dirty, saving, savedAt }) {
  if (saving) return <span className="text-faint">保存中…</span>;
  if (dirty) return <span className="text-amber-600 dark:text-amber-500">未保存</span>;
  if (savedAt) return <span className="text-accent">已保存</span>;
  return <span className="text-faint">已同步</span>;
}

/** A publish refusal, in words the author can act on. */
function publishProblem(reason) {
  switch (reason) {
    case "no_title":
      return "标题不能为空。";
    case "no_changes":
      return "没有未发布的改动。";
    case "no_draft":
      return "这篇文章还没有可发布的版本。";
    case "not_found":
      return "文章不存在，可能已被删除。";
    default:
      return "操作失败，请重试。";
  }
}
