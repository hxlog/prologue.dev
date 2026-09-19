"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  autosavePage,
  deletePageAction,
  publishPageAction,
  renamePageAction,
  renderPagePreview,
  unpublishPageAction,
} from "../../../actions/pages";
import { CodeMirrorEditor } from "../../../../../components/studio/codemirror";
import { ConfirmDialog } from "../../../../../components/studio/confirm-dialog";
import { MdxPreview } from "../../../../../components/studio/mdx-preview";
import { PageSettings } from "../../../../../components/studio/page-settings";
import { PageMetaPanel } from "../../../../../components/studio/page-meta-panel";
import { RenamePageDialog } from "../../../../../components/studio/page-rename-dialog";
import { IconTrash } from "../../../../../components/studio/icons";
import { readMeta, patchMeta } from "../../../../../lib/studio/frontmatter-doc";

/**
 * The page editor.
 *
 * Same shape as the post editor — uncontrolled CodeMirror, debounced autosave,
 * optimistic concurrency, publish-then-save — with three differences that come
 * from what a page is.
 *
 * ## The preview is COMPILED, not rendered
 *
 * A post's source is markdown and its published artifact is HTML, so the server
 * renders the preview with the same call that stores the revision. A page's
 * artifact is a COMPONENT, so the server compiles and the browser evaluates the
 * result with the same `MDXRenderer` the public route uses. The preview is the
 * real thing rather than an approximation of it.
 *
 * Compilation runs on its own 600ms debounce, shorter than autosave's 2.5s.
 * Two timers because they answer different questions: "is this valid MDX" wants
 * an answer while the author is still looking at the line; "is this worth
 * storing" does not.
 *
 * ## Two kinds of unsaved change, and they are not the same
 *
 * The couple of hundred bytes of frontmatter in the sidebar are part of the
 * document — editing the title rewrites a line of the `.mdx` source, and the
 * revision history records it. Everything in PageSettings is a column on the
 * `pages` row and is NOT versioned: a page restored to an older revision keeps
 * today's comment setting, because "which version of the text" and "should this
 * page have comments" are different questions and the history screen is about
 * the first one.
 *
 * ## Renaming is a dialog, not a field
 *
 * A page's slug is a URL people type and other pages link to, so it cannot sit
 * inline beside the title where a stray keystroke renames it. It gets a
 * confirmation that states both consequences — the redirect, and the nav entry
 * moving — before anything is written.
 */
export default function PageEditor({ initial }) {
  const router = useRouter();

  const [markdown, setMarkdown] = useState(initial.markdown);
  const [meta, setMeta] = useState(initial.meta);
  const [settings, setSettings] = useState(initial.settings);
  const [code, setCode] = useState(initial.code);
  const [compileError, setCompileError] = useState(initial.compileError ?? null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [savedAt, setSavedAt] = useState(null);
  const [revision, setRevision] = useState(initial.revisionNumber);
  const [status, setStatus] = useState(initial.status);
  const [pending, setPending] = useState(false);
  const [mobileTab, setMobileTab] = useState("source");
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Readable from the debounced callbacks without being a dependency of them.
  // `useCallback([markdown, meta])` would recreate the timer handler on every
  // keystroke and restart the debounce forever — the editor would never save.
  const latest = useRef({
    markdown: initial.markdown,
    meta: initial.meta,
    settings: initial.settings,
  });
  const revisionRef = useRef(initial.revisionNumber);
  const saveTimer = useRef(null);
  const compileTimer = useRef(null);
  const inFlight = useRef(false);

  // An unsaved document must not be lost to a stray navigation. Only the
  // browser's own dialog can block an unload, so this is where it is asked.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const flush = useCallback(async () => {
    if (inFlight.current) return null;
    inFlight.current = true;
    setSaving(true);

    try {
      const result = await autosavePage(initial.slug, {
        markdown: latest.current.markdown,
        meta: latest.current.meta,
        settings: latest.current.settings,
        revision: revisionRef.current,
      });

      if (result.ok) {
        revisionRef.current = result.revisionNumber;
        setRevision(result.revisionNumber);
        setDirty(false);
        setError(null);
        setSavedAt(Date.now());
      } else if (result.reason === "conflict") {
        setError("这个页面在别处被修改了。刷新后查看最新版本，或直接保存以覆盖。");
      } else if (result.reason === "invalid") {
        // The write path compiles before it stores, so this is the server
        // saying the document does not parse — the same error the preview
        // shows, raised by the same compile, one step later.
        setCompileError(result.message);
        setError("页面无法编译，未保存。");
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
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flush, 2500);
  }, [flush]);

  const recompile = useCallback(async (source) => {
    const result = await renderPagePreview(source);
    if (result.ok) {
      setCode(result.code);
      setCompileError(null);
    } else {
      setCompileError(result.message);
    }
  }, []);

  const onMarkdownChange = useCallback(
    (next) => {
      latest.current.markdown = next;
      setMarkdown(next);
      setMeta(readMeta(next));
      schedule();

      if (compileTimer.current) clearTimeout(compileTimer.current);
      compileTimer.current = setTimeout(() => recompile(next), 600);
    },
    [recompile, schedule]
  );

  /**
   * A frontmatter field changed.
   *
   * Patched into the document immediately rather than kept beside it, because
   * the frontmatter IS the document: `patchMeta` re-emits every untouched line
   * byte-identically, so editing the title here is indistinguishable from
   * editing that line in the code editor — except that it cannot break the YAML.
   */
  const onMetaChange = useCallback(
    (next) => {
      setMeta(next);
      const document = patchMeta(latest.current.markdown, {
        title: String(next.title ?? "").trim(),
        description: next.description ?? "",
      });
      latest.current.markdown = document;
      setMarkdown(document);
      schedule();
      if (compileTimer.current) clearTimeout(compileTimer.current);
      compileTimer.current = setTimeout(() => recompile(document), 600);
    },
    [recompile, schedule]
  );

  const onSettingsChange = useCallback(
    (next) => {
      latest.current.settings = next;
      setSettings(next);
      schedule();
    },
    [schedule]
  );

  /**
   * Publish, or unpublish.
   *
   * Saves first, always. The publish path publishes whichever revision the
   * draft pointer names, and unsaved keystrokes are not that revision —
   * reporting "published" for a document one edit behind the screen is the
   * worst thing a publish button can do.
   */
  const onPublish = useCallback(async () => {
    setPending(true);
    setNotice(null);
    try {
      if (dirty || saveTimer.current) {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        const saved = await flush();
        if (!saved?.ok) return;
      }

      const result =
        status === "published"
          ? await unpublishPageAction(initial.slug)
          : await publishPageAction(initial.slug);

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

  const published = status === "published";

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-30 -mx-4 border-b border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate font-mono text-xs text-muted">/{initial.slug}</h1>
            <div className="mt-1 flex items-center gap-2 text-xs">
              <span
                className={`rounded-full px-2 py-0.5 font-medium ${
                  published ? "bg-accent-soft text-accent" : "bg-surface-3 text-muted"
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
              onClick={() => {
                // A page's autosave holds the old slug too, and this one also
                // has a compile timer pointed at it.
                if (saveTimer.current) clearTimeout(saveTimer.current);
                if (compileTimer.current) clearTimeout(compileTimer.current);
                setRenaming(true);
              }}
              className={buttonGhost}
            >
              路径
            </button>
            {published && (
              <a
                href={`/${initial.slug}`}
                target="_blank"
                rel="noreferrer"
                className={buttonGhost}
              >
                查看
              </a>
            )}
            <button
              type="button"
              onClick={() => {
                if (saveTimer.current) clearTimeout(saveTimer.current);
                flush();
              }}
              disabled={saving}
              className={buttonGhost}
            >
              保存
            </button>
            {/*
              Deleting a page leaves a hole where a URL used to be, and the page
              may own a navigation entry. The dialog says both, because "delete"
              on a screen full of settings reads like "delete a draft" and this
              is the page the header links to.
            */}
            <button
              type="button"
              onClick={() => {
                if (saveTimer.current) clearTimeout(saveTimer.current);
                if (compileTimer.current) clearTimeout(compileTimer.current);
                setDeleting(true);
              }}
              aria-label="删除页面"
              // Ghost treatment, matching the post editor: a red destructive
              // control next to the primary publish button is one it is easier
              // to hit by accident than to hit on purpose. It turns red on
              // hover, so the colour arrives with the intent.
              className="flex h-7 w-7 items-center justify-center rounded-full text-faint transition-colors hover:bg-danger-soft hover:text-danger"
            >
              <IconTrash className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onPublish}
              disabled={pending || saving}
              style={{ background: "var(--gradient-brand)" }}
              className="rounded-lg px-3 py-1.5 text-xs font-medium btn-brand disabled:opacity-60"
            >
              {pending ? "处理中…" : published ? "撤回为草稿" : "发布"}
            </button>
          </div>
        </div>

        {error && (
          <p className="mt-2 whitespace-pre-wrap rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
            {error}
          </p>
        )}
        {notice && (
          <p className="mt-2 rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-xs text-accent">
            {notice}
          </p>
        )}
      </div>

      <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-start">
        <div
          className={`min-w-0 flex-1 ${mobileTab === "source" ? "block" : "hidden lg:block"}`}
        >
          <PageMetaPanel meta={meta} onChange={onMetaChange} slug={initial.slug} />
          <div className="mt-3">
            <PageSettings settings={settings} onChange={onSettingsChange} />
          </div>
          <CodeMirrorEditor
            initialValue={initial.markdown}
            onChange={onMarkdownChange}
            className="mt-3"
          />
        </div>

        <div
          className={`w-full lg:w-[44%] lg:shrink-0 ${
            mobileTab === "preview" ? "block" : "hidden lg:block"
          }`}
        >
          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="text-xs font-medium text-muted">预览</span>
              {compileError && <span className="text-[11px] text-danger">编译失败</span>}
            </div>
            {/*
              Capped and scrollable, matching `preview-pane.js`.

              Without this the pane is as tall as the compiled page, so a long
              MDX page produces a preview several screens long with the tab bar
              stranded at the bottom of it — the author scrolls through the
              whole rendered document to get back to "Markdown". The post
              editor's preview has always had this cap; the page editor's did
              not, which made two controls with the same label behave
              differently. The number is the same one `preview-pane.js` uses,
              and for the same reason: both panes sit under the same sticky
              `Bar`.

              The scroll is INSIDE the pane, so the tab bar below stays where
              it is rather than floating over the document.
            */}
            <div className="max-h-[calc(100vh-12rem)] overflow-y-auto p-4">
              <MdxPreview code={code} error={compileError} />
            </div>
          </div>
        </div>
      </div>

      <div
        className="sticky bottom-0 z-20 -mx-4 mt-4 border-t border-border bg-surface/95 px-4 py-2 backdrop-blur lg:hidden"
        style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
      >
        <div className="flex gap-1 rounded-lg bg-surface-2 p-1">
          {[
            ["source", "MDX"],
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

      {renaming && (
        <RenamePageDialog
          slug={initial.slug}
          onClose={(result) => {
            setRenaming(false);
            if (!result?.ok) return;
            setNotice(
              `已重命名为 /${result.slug}，旧路径 /${result.previous} 已设置永久跳转。`
            );
            router.push(`/studio/pages/${result.slug}`);
            router.refresh();
          }}
          onRename={(next) => renamePageAction(initial.slug, next)}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={`删除《${meta.title || initial.slug}》`}
          intro="这会连同这个页面的全部版本历史一起删除，无法撤销。"
          consequences={[
            `路径 /${initial.slug} 将不再存在，也不会留下跳转。`,
            initial.showInNav
              ? "导航栏里的条目会一并移除。"
              : "它在导航栏中没有条目。",
            "搜索记录会一并删除。",
          ]}
          confirmWord={initial.slug}
          confirmLabel="永久删除"
          onConfirm={() => deletePageAction(initial.slug)}
          onClose={(result) => {
            if (!result?.ok) return;
            router.push("/studio/pages");
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function SaveState({ dirty, saving, savedAt }) {
  if (saving) return <span className="text-faint">保存中…</span>;
  if (dirty) return <span className="text-warn">未保存</span>;
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
      return "这个页面还没有可发布的版本。";
    case "not_found":
      return "页面不存在，可能已被删除。";
    default:
      return "操作失败，请重试。";
  }
}

const buttonGhost =
  "rounded-lg border border-border px-3 py-1.5 text-xs text-muted transition-colors " +
  "hover:bg-surface-2 hover:text-accent disabled:opacity-50";
