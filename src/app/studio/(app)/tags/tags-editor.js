"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  addAliasAction,
  createTagAction,
  deleteTagAction,
  removeAliasAction,
  renameTagAction,
  updateTagAction,
} from "../../actions/tags";
import { IconClose, IconExternal, IconPlus, IconWarning } from "../../../../components/studio/icons";

/**
 * The taxonomy.
 *
 * Fifteen tags, all of them visible at once, each editable in place. There is
 * no pagination and no search box, for the same reason the post list has
 * neither: the whole list fits on a screen, and a filter over fifteen rows is a
 * control that teaches the reader the page is more complicated than it is.
 *
 * ## The two facts that matter, in order
 *
 * A tag's SLUG is a URL other people link to, and a tag's LABEL is what readers
 * see. Renaming the label is free. Renaming the slug is not — it retires a
 * public URL — so it lives behind a confirmation that spells out the redirect
 * it will write. That asymmetry is the whole design of this screen, and it is
 * why the two fields are edited by different controls rather than sitting in
 * one form.
 *
 * ## Deletion asks twice when a tag is in use
 *
 * The server refuses a plain delete while posts carry the tag, and the refusal
 * carries the count. The screen does not hide behind that refusal: removing a
 * tag from a post is exactly what the author came here to do when they
 * mistyped one, so the second confirmation states how many posts will lose it
 * and then passes `force`.
 *
 * Two dialogs, not one, because they are different acts. The first is "remove
 * this row from the taxonomy"; the second is "and rewrite N posts". Collapsing
 * them would make the destructive one a reflex.
 */
export default function TagsEditor({ initial }) {
  const router = useRouter();

  const [tags, setTags] = useState(initial);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [renaming, setRenaming] = useState(null);
  /** The tag whose alias is being added, or null. */
  const [aliasing, setAliasing] = useState(null);
  const [aliasDraft, setAliasDraft] = useState("");
  const [draft, setDraft] = useState({ slug: "", label: "" });
  const [pending, startTransition] = useTransition();

  /**
   * Run a write, then refresh so the list reflects it.
   *
   * Returns a promise for the action's result rather than nothing, because the
   * rename dialog needs to know whether to close.
   *
   * The write is started OUTSIDE `startTransition` and its promise handed in.
   * React ends a transition when an async callback first awaits, so the pending
   * state it drives would flicker off while the request was still in flight —
   * and `busyId` is what every control on this screen disables itself on.
   */
  function run(id, fn, success) {
    setBusyId(id);
    setError(null);
    setNotice(null);

    const work = (async () => {
      const result = await fn();
      setBusyId(null);

      if (result?.ok) {
        if (success) setNotice(success);
        router.refresh();
      } else {
        setError(problem(result?.reason, result));
      }
      return result;
    })();

    startTransition(() => {
      void work;
    });

    return work;
  }

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
        {tags.map((tag) => (
          <li key={tag.id} className="px-3 py-2.5">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  <input
                    type="text"
                    defaultValue={tag.label}
                    aria-label={`标签名称 ${tag.slug}`}
                    onBlur={(e) => {
                      const label = e.target.value.trim();
                      if (!label || label === tag.label) return;
                      run(
                        tag.id,
                        () => updateTagAction(tag.id, { label }),
                        "名称已更新。"
                      );
                    }}
                    className={`${inline} w-32`}
                  />
                  <span className="font-mono text-[11px] text-faint">{tag.slug}</span>
                  {busyId === tag.id && <span className="text-[11px] text-faint">保存中…</span>}
                </div>

                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-faint">
                  <span>
                    {tag.published_posts} 篇已发布
                    {tag.total_posts !== tag.published_posts &&
                      ` · ${tag.total_posts} 篇含草稿`}
                  </span>
                  {tag.aliases?.length > 0 && (
                    <span className="flex flex-wrap items-center gap-1">
                      别名：
                      {tag.aliases.map((alias) => (
                        <button
                          key={alias}
                          type="button"
                          disabled={pending}
                          onClick={() =>
                            run(
                              tag.id,
                              () => removeAliasAction(alias),
                              `已移除别名 /tags/${alias}。`
                            )
                          }
                          title={`移除别名 /tags/${alias}`}
                          className="inline-flex items-center gap-0.5 rounded-full bg-surface-3 px-2 py-0.5 font-mono text-[10px] text-muted transition-colors hover:text-danger disabled:opacity-40"
                        >
                          {alias}
                          <IconClose className="h-2.5 w-2.5" />
                        </button>
                      ))}
                    </span>
                  )}
                  {/*
                    An alias is an old slug a URL still points at, and without a
                    way to add one the only aliases that exist are the ones a
                    rename happened to leave behind. That is backwards: the
                    common case is retrofitting a redirect for a tag that moved
                    before this system existed.
                  */}
                  {aliasing === tag.id ? (
                    <span className="flex items-center gap-1">
                      <span className="font-mono text-faint">/tags/</span>
                      <input
                        type="text"
                        value={aliasDraft}
                        autoFocus
                        autoComplete="off"
                        spellCheck={false}
                        onChange={(e) => setAliasDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            setAliasing(null);
                            setAliasDraft("");
                          }
                          if (e.key === "Enter" && aliasDraft.trim()) {
                            const value = aliasDraft.trim();
                            setAliasing(null);
                            setAliasDraft("");
                            run(tag.id, () => addAliasAction(tag.id, value), `已添加别名 /tags/${value}。`);
                          }
                        }}
                        placeholder="旧路径"
                        aria-label={`为 ${tag.label} 添加别名`}
                        className="w-24 rounded-full border border-border bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-foreground focus:border-accent focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setAliasing(null);
                          setAliasDraft("");
                        }}
                        className="text-[10px] text-faint hover:text-accent"
                      >
                        取消
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        setAliasing(tag.id);
                        setAliasDraft("");
                      }}
                      className="text-[10px] text-faint underline-offset-2 transition-colors hover:text-accent hover:underline disabled:opacity-40"
                    >
                      + 别名
                    </button>
                  )}
                </p>
              </div>

              <a
                href={`/tags/${tag.slug}`}
                target="_blank"
                rel="noreferrer"
                aria-label={`查看 /tags/${tag.slug}`}
                className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-full text-faint transition-colors hover:bg-surface-3 hover:text-accent sm:flex"
              >
                <IconExternal className="h-3.5 w-3.5" />
              </a>

              <button
                type="button"
                onClick={() => setRenaming(tag)}
                className="shrink-0 rounded-lg border border-border px-2 py-1 text-[11px] text-muted transition-colors hover:bg-surface-2 hover:text-accent"
              >
                改路径
              </button>

              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  if (!window.confirm(`删除标签「${tag.label}」？`)) return;
                  // `force` when the tag is in use, so the server detaches it
                  // from every post instead of refusing. Confirmed first: this
                  // is the difference between "remove a tag nobody uses" and
                  // "strip a tag off N posts", and the dialog says which one it
                  // is about to be.
                  const force = tag.total_posts > 0;
                  if (
                    force &&
                    !window.confirm(
                      `「${tag.label}」正被 ${tag.total_posts} 篇文章使用，` +
                        "删除会把这些文章上的这个标签一并去掉。继续？"
                    )
                  ) {
                    return;
                  }
                  setTags(tags.filter((t) => t.id !== tag.id));
                  run(
                    tag.id,
                    () => deleteTagAction(tag.id, force),
                    force
                      ? `标签已删除，并从 ${tag.total_posts} 篇文章上移除。`
                      : "标签已删除。"
                  );
                }}
                aria-label={`删除标签 ${tag.label}`}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-faint transition-colors hover:bg-surface-3 hover:text-danger disabled:opacity-40"
              >
                <IconClose className="h-3.5 w-3.5" />
              </button>
            </div>
          </li>
        ))}
      </ul>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.slug.trim() && !draft.label.trim()) return;
          run(
            "new",
            () => createTagAction({ slug: draft.slug, label: draft.label }),
            "标签已创建。"
          );
          setDraft({ slug: "", label: "" });
        }}
        className="rounded-xl border border-border bg-surface p-3"
      >
        <p className="mb-2 text-xs font-medium text-muted">新建标签</p>
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input
            type="text"
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            placeholder="中文名称"
            aria-label="新标签名称"
            className={input}
          />
          <input
            type="text"
            value={draft.slug}
            onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
            placeholder="Slug（英文，用于网址）"
            aria-label="新标签 slug"
            className={`${input} font-mono text-xs`}
          />
          <button
            type="submit"
            disabled={pending || (!draft.slug.trim() && !draft.label.trim())}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium btn-brand disabled:opacity-40"
            style={{ background: "var(--gradient-brand)" }}
          >
            <IconPlus className="h-4 w-4" />
            创建
          </button>
        </div>
        <p className="mt-2 text-[11px] leading-5 text-faint">
          slug 会成为 <span className="font-mono">/tags/&lt;slug&gt;</span> 的一部分，
          大小写敏感，创建后改名会自动为旧地址保留跳转。
        </p>
      </form>

      <p className="flex items-start gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-xs text-muted">
        <IconWarning className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
        <span>
          标签的英文 slug 与 <span className="font-mono">data/tagLabels.js</span> 无关，
          显示名称已经存在数据库中，改这里就会改全站的显示。
        </span>
      </p>

      {renaming && (
        <RenameTag
          tag={renaming}
          onClose={() => setRenaming(null)}
          onRename={(next) =>
            run(
              renaming.id,
              () => renameTagAction(renaming.id, next),
              `路径已改为 /tags/${next}，旧地址已保留跳转。`
            ).then((result) => {
              if (result?.ok) setRenaming(null);
            })
          }
        />
      )}
    </div>
  );
}

function RenameTag({ tag, onClose, onRename }) {
  const [next, setNext] = useState(tag.slug);
  const [busy, setBusy] = useState(false);
  const changed = next.trim() && next.trim() !== tag.slug;

  async function submit(e) {
    e.preventDefault();
    if (!changed || busy) return;
    setBusy(true);
    await onRename(next.trim());
    setBusy(false);
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
        // Capped and scrollable, in `dvh`. See the note in confirm-dialog.js:
        // an uncapped bottom-anchored dialog on a phone is a dialog whose
        // submit button the soft keyboard covers, and iOS does not resize the
        // layout viewport to tell us about it.
        className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-border bg-surface p-4 sm:rounded-2xl"
      >
        <h2 className="text-sm font-semibold text-foreground">修改标签路径</h2>
        <p className="mt-1 text-xs text-muted">
          <span className="font-mono">/tags/{tag.slug}</span> 是公开网址，其他人可能已经链接过它。
        </p>

        <label htmlFor="tag-slug" className="mt-4 mb-1 block text-xs font-medium text-muted">
          新 slug
        </label>
        <input
          id="tag-slug"
          type="text"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoFocus
          className={`${input} font-mono`}
        />

        {changed && (
          <div className="mt-3 space-y-1 rounded-lg border border-border bg-surface-2 px-3 py-2 text-[11px] text-muted">
            <p>
              <span className="font-mono text-faint">/tags/{tag.slug}</span> 会保留跳转到{" "}
              <span className="font-mono text-accent">/tags/{next.trim()}</span>
            </p>
            <p>旧地址会作为别名保留，读者不会遇到 404。</p>
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className={ghost}>
            取消
          </button>
          <button
            type="submit"
            disabled={!changed || busy}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium btn-brand disabled:opacity-40"
          >
            {busy ? "处理中…" : "修改路径"}
          </button>
        </div>
      </form>
    </div>
  );
}

function problem(reason, result) {
  switch (reason) {
    case "in_use":
      return `这个标签还被 ${result?.count ?? "若干"} 篇文章使用，无法删除。`;
    case "duplicate":
      return `已经有一个标签使用 ${result?.slug ?? "这个"} 路径或别名。`;
    case "alias_conflict":
      return `「${result?.slug ?? ""}」已经是另一个标签的别名。`;
    case "invalid_slug":
      return "slug 不能为空，且只能包含字母、数字、下划线和短横线。";
    case "invalid_label":
      return "名称不能为空。";
    case "not_found":
      return "这个标签已经不存在了，刷新后重试。";
    default:
      return "操作失败，请重试。";
  }
}

const inline =
  "rounded-lg border border-transparent bg-transparent px-1 py-0.5 text-sm text-foreground " +
  "transition-colors hover:border-border focus:border-accent focus:bg-surface-2 focus:outline-none";

const input =
  "w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-foreground " +
  "placeholder:text-faint transition-colors focus:border-accent focus:outline-none " +
  "focus-visible:ring-2 focus-visible:ring-accent/40";

const ghost =
  "rounded-lg border border-border px-3 py-1.5 text-xs text-muted transition-colors " +
  "hover:bg-surface-2 hover:text-accent disabled:opacity-50";
