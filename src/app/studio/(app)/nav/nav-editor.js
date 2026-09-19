"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  createNavItemAction,
  deleteNavItemAction,
  reorderNavItemsAction,
  updateNavItemAction,
} from "../../actions/nav";
import { IconClose, IconPlus, IconWarning } from "../../../../components/studio/icons";

/**
 * The navigation editor.
 *
 * The whole list is one form rather than a row-per-form, because the interesting
 * operation is "these five links, in this order" — and reordering is a property
 * of the list, not of a row. Saving sends the whole thing.
 *
 * ## Why the order is arrow buttons and not drag
 *
 * Drag-and-drop over a list of five items on a phone is a worse experience than
 * two taps on a 44px target, and the header is the one part of the site that is
 * almost always edited from a phone. The arrows are also keyboard-operable for
 * free, which a drag handle is not.
 *
 * ## What is deliberately NOT here
 *
 * No route picker. The author knows their own routes — /blog, /microblog,
 * /links — and a dropdown of "pages you could link to" would be a list the
 * studio maintains and the author does not want. External links are a checkbox,
 * not a URL field detected by regex: an author writing `https://` for an
 * internal link is a mistake the checkbox makes impossible.
 */
export default function NavEditor({ initial }) {
  const router = useRouter();

  const [items, setItems] = useState(initial);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState({ label: "", href: "", external: false });

  /** Run a write, then refresh so the header reflects it. */
  function run(id, fn, success) {
    setBusyId(id);
    setError(null);
    setNotice(null);

    startTransition(async () => {
      const result = await fn();
      setBusyId(null);

      if (result?.ok) {
        if (success) setNotice(success);
        router.refresh();
      } else {
        setError(problem(result?.reason));
      }
    });
  }

  function move(index, delta) {
    const next = index + delta;
    if (next < 0 || next >= items.length) return;

    const reordered = [...items];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(next, 0, moved);

    // Optimistic: the list is the source of truth for the drag, and a reorder
    // that waited for a round trip before moving would feel broken even when it
    // was not. The server's answer is the same order, so a failure is the only
    // case where this is visible — and that restores from `initial`.
    setItems(reordered);
    run(
      moved.id,
      () => reorderNavItemsAction(reordered.map((i) => i.id)),
      null
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-xl border border-accent/30 bg-accent-soft px-4 py-3 text-sm text-accent">
          {notice}
        </p>
      )}

      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
        {items.length === 0 && (
          <li className="px-4 py-10 text-center text-sm text-faint">
            导航栏是空的，站点标题是唯一的链接。
          </li>
        )}

        {items.map((item, index) => (
          <li key={item.id} className="px-3 py-2.5">
            <div className="flex items-start gap-2">
              <div className="flex shrink-0 flex-col gap-0.5 pt-0.5">
                <button
                  type="button"
                  onClick={() => move(index, -1)}
                  disabled={index === 0 || pending}
                  aria-label={`上移 ${item.label}`}
                  className={arrow}
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => move(index, 1)}
                  disabled={index === items.length - 1 || pending}
                  aria-label={`下移 ${item.label}`}
                  className={arrow}
                >
                  ↓
                </button>
              </div>

              <div className="min-w-0 flex-1 space-y-2">
                <div className="grid gap-2 sm:grid-cols-[1fr_1fr]">
                  <Labelled label="名称" id={`nav-label-${item.id}`}>
                    <input
                      id={`nav-label-${item.id}`}
                      type="text"
                      defaultValue={item.label}
                      onBlur={(e) => {
                        const label = e.target.value.trim();
                        if (!label || label === item.label) return;
                        run(item.id, () => updateNavItemAction(item.id, { label }));
                      }}
                      className={input}
                    />
                  </Labelled>
                  <Labelled label="链接" id={`nav-href-${item.id}`}>
                    <input
                      id={`nav-href-${item.id}`}
                      type="text"
                      defaultValue={item.href}
                      onBlur={(e) => {
                        const href = e.target.value.trim();
                        if (!href || href === item.href) return;
                        run(item.id, () => updateNavItemAction(item.id, { href }));
                      }}
                      className={`${input} font-mono text-xs`}
                    />
                  </Labelled>
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted">
                  <Check
                    id={`nav-visible-${item.id}`}
                    label="显示"
                    checked={item.visible}
                    disabled={pending}
                    onChange={(visible) =>
                      run(item.id, () => updateNavItemAction(item.id, { visible }))
                    }
                  />
                  <Check
                    id={`nav-external-${item.id}`}
                    label="外部链接"
                    checked={item.external}
                    disabled={pending}
                    onChange={(external) =>
                      run(item.id, () => updateNavItemAction(item.id, { external }))
                    }
                  />
                  {item.page_slug && (
                    <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[11px] text-faint">
                      页面 /{item.page_slug}
                    </span>
                  )}
                  {busyId === item.id && <span className="text-faint">保存中…</span>}
                </div>

                {/*
                  A page-backed entry is not deletable here. Its existence is
                  the page's `show_in_nav` flag, and removing the row from this
                  list would make that checkbox lie — the next save of the page
                  would create it again. Turning the page's switch off is the
                  way, and the link below goes to it.
                */}
                {item.page_slug ? (
                  <p className="text-[11px] text-faint">
                    由页面{" "}
                    <a
                      href={`/studio/pages/${item.page_slug}`}
                      className="text-accent hover:underline"
                    >
                      /{item.page_slug}
                    </a>{" "}
                    的“显示在导航栏”开关控制。
                  </p>
                ) : (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      run(item.id, () => deleteNavItemAction(item.id), "已删除。")
                    }
                    className="inline-flex items-center gap-1 text-[11px] text-faint transition-colors hover:text-red-500 disabled:opacity-50"
                  >
                    <IconClose className="h-3 w-3" />
                    删除
                  </button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.label.trim() || !draft.href.trim()) return;
          run(
            "new",
            () => createNavItemAction(draft),
            "已添加，可在列表中用箭头调整顺序。"
          );
          setDraft({ label: "", href: "", external: false });
        }}
        className="rounded-xl border border-border bg-surface p-3"
      >
        <p className="mb-2 text-xs font-medium text-muted">添加链接</p>
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input
            type="text"
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            placeholder="名称"
            aria-label="新链接名称"
            className={input}
          />
          <input
            type="text"
            value={draft.href}
            onChange={(e) => setDraft({ ...draft, href: e.target.value })}
            placeholder="/now"
            aria-label="新链接地址"
            className={`${input} font-mono text-xs`}
          />
          <button
            type="submit"
            disabled={pending || !draft.label.trim() || !draft.href.trim()}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <IconPlus className="h-4 w-4" />
            添加
          </button>
        </div>
        <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={draft.external}
            onChange={(e) => setDraft({ ...draft, external: e.target.checked })}
            className="h-4 w-4 rounded border-border text-accent focus:ring-accent/40"
          />
          外部链接（在新标签页打开）
        </label>
      </form>

      <p className="flex items-start gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-xs text-muted">
        <IconWarning className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <span>
          这里只编辑链接本身，不会创建页面或路由。指向不存在的路径会在读者点击时得到 404。
        </span>
      </p>
    </div>
  );
}

function Labelled({ label, id, children }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[11px] font-medium text-faint">
        {label}
      </label>
      {children}
    </div>
  );
}

function Check({ id, label, checked, disabled, onChange }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center gap-1.5">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-border text-accent focus:ring-accent/40"
      />
      {label}
    </label>
  );
}

function problem(reason) {
  switch (reason) {
    case "invalid":
      return "名称和链接都不能为空。";
    case "not_found":
      return "这个链接已经不存在了，刷新后重试。";
    case "nothing_to_update":
      return "没有需要保存的改动。";
    case "empty":
      return "顺序不能为空。";
    default:
      return "操作失败，请重试。";
  }
}

const arrow =
  "flex h-6 w-6 items-center justify-center rounded-md border border-border text-xs " +
  "text-faint transition-colors hover:bg-surface-2 hover:text-accent disabled:opacity-30";

const input =
  "w-full rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm text-foreground " +
  "placeholder:text-faint transition-colors focus:border-accent focus:outline-none " +
  "focus-visible:ring-2 focus-visible:ring-accent/40";
