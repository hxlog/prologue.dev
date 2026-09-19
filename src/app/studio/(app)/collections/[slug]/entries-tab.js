"use client";

import { useState } from "react";

import { IconChevron, IconClose, IconPin, IconPlus } from "../../../../../components/studio/icons";
import { FieldInput } from "../../../../../components/studio/field-input";

/**
 * The entries tab.
 *
 * One list, one entry expanded at a time, and the form is generated from the
 * collection's own field definitions — which is the whole point of a collection
 * being a schema rather than a shape baked into code. Nothing here knows what a
 * microblog entry is.
 *
 * ## Why the list is not virtualised
 *
 * The microblog has 26 entries and the friend links have 9. A virtualised list
 * would be machinery for a corpus two orders of magnitude larger, and it would
 * break the one interaction this screen is for: scrolling to find the entry you
 * wrote last week. If a collection ever reaches a thousand entries, the answer
 * is a filter, not a window.
 *
 * ## Drafts
 *
 * `status` is the whole of an entry's publish state — an entry is a row, with
 * no revision history and no separate draft pointer. That is deliberate: a
 * microblog entry is a sentence, and versioning it would be machinery for a
 * problem that does not exist. The toggle is here rather than hidden in a menu
 * because a draft entry is invisible on the public page and the author needs to
 * be able to see that at a glance.
 *
 * ## Reordering only exists for a `manual` collection
 *
 * `sortable` is the collection's `ordering` setting, and it is not cosmetic.
 * The reader query for a `date` collection orders by `published_at` first, so a
 * move would appear to do nothing at all — a control that silently has no
 * effect is worse than no control, so the arrows are not rendered. Microblog is
 * `date`; the friend links are `manual` and get them.
 *
 * The pin is gated on the same setting because `sort_pinned` is only read in the
 * `manual` branch of that query (src/lib/content/collections.js).
 */
export default function EntriesTab({
  fields,
  entries,
  pending,
  busyId,
  sortable = false,
  onSave,
  onDelete,
  onToggleStatus,
  onMove,
  onTogglePin,
}) {
  const [expanded, setExpanded] = useState(null);
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-3">
      {creating ? (
        <EntryForm
          fields={fields}
          entry={null}
          busy={pending}
          onCancel={() => setCreating(false)}
          onSubmit={(values, status) => {
            onSave(null, { values, status });
            setCreating(false);
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          style={{ background: "var(--gradient-brand)" }}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium btn-brand"
        >
          <IconPlus className="h-4 w-4" />
          新建条目
        </button>
      )}

      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
        {entries.length === 0 && (
          <li className="px-4 py-10 text-center text-sm text-faint">
            这个集合还没有条目。
          </li>
        )}

        {entries.map((entry, index) => {
          const open = expanded === entry.id;
          return (
            <li key={entry.id} className="px-3 py-2.5">
              <div className="flex items-start gap-2">
                {sortable && (
                  // 16×20 each, so 40px tall as a pair with the gap. Small, and
                  // honestly so: `h-4 w-5` is a chevron glyph, not a button.
                  //
                  // It is left at that size because growing it to a thumb target
                  // doubles the height of every row in a list where the common
                  // operation is READING entries and reordering is rare — and a
                  // row of 88px controls is a list that looks like a control
                  // panel. What it does have is a correct `aria-label` per entry
                  // ("上移 <anchor>") and `disabled` at the ends rather than a
                  // hidden button, so it is reachable and operable by keyboard
                  // and by screen reader even where it is fiddly by thumb.
                  //
                  // Recorded rather than silently accepted: if reordering turns
                  // out to be used on a phone, the fix is a drag handle with a
                  // full-row hit area, not two larger chevrons.
                  <div className="flex shrink-0 flex-col">
                    <button
                      type="button"
                      disabled={pending || index === 0}
                      onClick={() => onMove(entry.id, -1)}
                      aria-label={`上移 ${entry.anchor}`}
                      className="flex h-4 w-5 items-center justify-center rounded text-faint transition-colors hover:text-accent disabled:opacity-20"
                    >
                      <IconChevron className="h-3 w-3 -rotate-90" />
                    </button>
                    <button
                      type="button"
                      disabled={pending || index === entries.length - 1}
                      onClick={() => onMove(entry.id, 1)}
                      aria-label={`下移 ${entry.anchor}`}
                      className="flex h-4 w-5 items-center justify-center rounded text-faint transition-colors hover:text-accent disabled:opacity-20"
                    >
                      <IconChevron className="h-3 w-3 rotate-90" />
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : entry.id)}
                  aria-expanded={open}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="truncate text-sm text-foreground">{preview(entry, fields)}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-faint">
                    {entry.status !== "published" && (
                      <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[11px] text-muted">
                        草稿
                      </span>
                    )}
                    {entry.sort_pinned && (
                      <span className="rounded-full bg-secondary-soft px-2 py-0.5 text-[11px] text-secondary-strong">
                        置顶
                      </span>
                    )}
                    <span className="font-mono text-[11px]">{entry.anchor}</span>
                    <span>{shortDate(entry.published_at ?? entry.created_at)}</span>
                    {busyId === entry.id && <span>保存中…</span>}
                  </p>
                </button>

                {sortable && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => onTogglePin(entry)}
                    aria-pressed={entry.sort_pinned}
                    aria-label={entry.sort_pinned ? `取消置顶 ${entry.anchor}` : `置顶 ${entry.anchor}`}
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-40 ${
                      entry.sort_pinned
                        ? "text-secondary-strong hover:bg-surface-3"
                        : "text-faint hover:bg-surface-3 hover:text-accent"
                    }`}
                  >
                    <IconPin className="h-3.5 w-3.5" />
                  </button>
                )}

                <button
                  type="button"
                  disabled={pending}
                  onClick={() => onDelete(entry)}
                  aria-label={`删除条目 ${entry.anchor}`}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-faint transition-colors hover:bg-surface-3 hover:text-danger disabled:opacity-40"
                >
                  <IconClose className="h-3.5 w-3.5" />
                </button>
              </div>

              {open && (
                <EntryForm
                  fields={fields}
                  entry={entry}
                  busy={pending}
                  onCancel={() => setExpanded(null)}
                  onToggleStatus={(status) => onToggleStatus(entry.id, status)}
                  onSubmit={(values, status) => {
                    onSave(entry.id, { values, status });
                    setExpanded(null);
                  }}
                />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function EntryForm({ fields, entry, busy, onSubmit, onCancel, onToggleStatus }) {
  const [values, setValues] = useState(() => initialValues(fields, entry));
  const [status, setStatus] = useState(entry?.status ?? "published");

  const published = status === "published";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(values, status);
      }}
      className="mt-3 space-y-3 border-t border-border pt-3"
    >
      {fields.map((field) => (
        <FieldInput
          key={field.id}
          field={field}
          disabled={busy}
          value={values[field.key]}
          onChange={(value) => setValues({ ...values, [field.key]: value })}
        />
      ))}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={published}
            disabled={busy}
            onChange={(e) => {
              const next = e.target.checked ? "published" : "draft";
              setStatus(next);
              // Applied immediately rather than on save. Publishing state is not
              // part of the entry's values and a half-saved publication would be
              // a state nobody asked for.
              if (entry && onToggleStatus) onToggleStatus(next);
            }}
            className="h-4 w-4 rounded border-border text-accent focus:ring-accent/40"
          />
          {published ? "已发布" : "草稿（公开页面不可见）"}
        </label>

        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className={ghost}>
            取消
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium btn-brand disabled:opacity-40"
          >
            {entry ? "保存" : "创建"}
          </button>
        </div>
      </div>
    </form>
  );
}

/**
 * Bound an entry's values to the form.
 *
 * Every field gets an initial value even when the entry does not have one, so
 * the inputs are controlled from the first render rather than flipping from
 * uncontrolled to controlled when the author types — which React warns about
 * and which drops the cursor in some browsers.
 */
function initialValues(fields, entry) {
  const out = {};
  for (const field of fields) {
    const value = entry?.values?.[field.key];
    if (value !== undefined) {
      out[field.key] = value;
      continue;
    }
    switch (field.type) {
      case "boolean":
        out[field.key] = field.default_value === true;
        break;
      case "image_gallery":
        out[field.key] = [];
        break;
      case "image":
        out[field.key] = { src: "", alt: "" };
        break;
      default:
        out[field.key] = "";
    }
  }
  return out;
}

/**
 * The one line that identifies an entry in the list.
 *
 * The first text-shaped field with something in it, truncated. Reading the
 * "first long_text" instead would show the friend links' `description` for
 * entries whose name is what identifies them, which is worse than a rule that
 * is merely arbitrary — so it prefers `name`, then `title`, then the first
 * text-ish field that is not empty.
 */
function preview(entry, fields) {
  const values = entry.values ?? {};
  const preferred = ["name", "title", "content"];
  for (const key of preferred) {
    const text = values[key];
    if (typeof text === "string" && text.trim()) return truncate(text);
  }
  for (const field of fields) {
    const text = values[field.key];
    if (typeof text === "string" && text.trim()) return truncate(text);
  }
  return entry.anchor;
}

function truncate(text) {
  const clean = String(text).replace(/\s+/g, " ").trim();
  return clean.length > 80 ? `${clean.slice(0, 80)}…` : clean;
}

function shortDate(value) {
  if (!value) return "—";
  return new Date(value).toISOString().slice(0, 10);
}

const ghost =
  "rounded-lg border border-border px-3 py-1.5 text-xs text-muted transition-colors " +
  "hover:bg-surface-2 hover:text-accent disabled:opacity-50";
