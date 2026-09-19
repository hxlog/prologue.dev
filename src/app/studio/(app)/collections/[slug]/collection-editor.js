"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  deleteEntryAction,
  deleteFieldAction,
  saveEntryAction,
  saveFieldAction,
  setEntryStatusAction,
} from "../../../actions/collections";
import EntriesTab from "./entries-tab";
import FieldsTab from "./fields-tab";

/**
 * The collection editor's interactive half.
 *
 * Two tabs over one collection: its FIELDS (the schema) and its ENTRIES (the
 * data). The tabs are client state rather than routes, because switching
 * between them is not a navigation — the author is looking at one thing and
 * flipping to the other side of it, and a route change would remount the list
 * and lose the scroll position on every flip.
 *
 * ## Why the two writes invalidate different things
 *
 * Editing a field changes the FORM. Adding an entry changes the PAGE. They are
 * different cache tags on the server (see the actions module) and this component
 * does not need to know which — it calls `router.refresh()` after either and the
 * invalidation is already done by the time the refresh reads.
 *
 * ## Optimistic where it is safe, confirmed where it is not
 *
 * Nothing here is optimistic. Reordering in the navigation editor is, because
 * the new order is knowable on the client and a reorder that waited would feel
 * broken. Creating or deleting an ENTRY is not: the server assigns the anchor,
 * and the anchor is what the list shows — a row drawn with a guessed anchor
 * would flicker to a different one when the write landed.
 */
export default function CollectionEditor({ slug, collection, entries: initialEntries }) {
  const router = useRouter();

  const [tab, setTab] = useState("entries");
  const [entries, setEntries] = useState(initialEntries);
  const [fields, setFields] = useState(collection.fields);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [pending, startTransition] = useTransition();

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
        setError(problem(result?.reason, result?.key));
      }
    });
  }

  function saveEntry(entryId, payload) {
    run(
      entryId ?? "new",
      () => saveEntryAction(slug, entryId, payload),
      entryId ? "已保存。" : "已创建。"
    );
  }

  function deleteEntry(entry) {
    // Confirmed by the anchor rather than by a dialog. The anchor is the entry's
    // identity — it is the id in the public page and the guid in the RSS feed —
    // so making the author type it is a real confirmation rather than a reflex
    // click, and there is no undo for a deleted entry.
    const typed = window.prompt(
      `删除后无法恢复。输入 ${entry.anchor} 确认删除：`,
      ""
    );
    if (typed === null) return;
    if (typed.trim() !== entry.anchor) {
      setError("确认不匹配，未删除。");
      return;
    }

    setEntries(entries.filter((e) => e.id !== entry.id));
    run(entry.id, () => deleteEntryAction(slug, entry.id), "已删除。");
  }

  function toggleStatus(entryId, status) {
    run(entryId, () => setEntryStatusAction(slug, entryId, status), null);
  }

  function saveField(fieldId, input) {
    run(
      fieldId ?? "new-field",
      () => saveFieldAction(slug, fieldId, input),
      fieldId ? "字段已更新。" : "字段已添加。"
    );
  }

  function deleteField(field) {
    if (
      !window.confirm(
        `删除字段「${field.label}」？\n\n` +
          "已有条目中的值会保留在数据里，重新添加同名字段即可恢复。" +
          "但表单将不再包含这个字段。"
      )
    ) {
      return;
    }
    setFields(fields.filter((f) => f.id !== field.id));
    run(field.id, () => deleteFieldAction(slug, field.id), "字段已删除。");
  }

  return (
    <div className="space-y-3">
      <nav className="flex gap-1 rounded-lg bg-surface-2 p-1">
        {[
          ["entries", `条目 (${entries.length})`],
          ["fields", `字段 (${fields.length})`],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            aria-current={tab === key ? "true" : undefined}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm transition-colors sm:flex-none ${
              tab === key
                ? "bg-surface font-medium text-foreground shadow-sm"
                : "text-muted hover:text-accent"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

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

      {tab === "entries" ? (
        <EntriesTab
          fields={fields}
          entries={entries}
          pending={pending}
          busyId={busyId}
          onSave={saveEntry}
          onDelete={deleteEntry}
          onToggleStatus={toggleStatus}
        />
      ) : (
        <FieldsTab
          fields={fields}
          pending={pending}
          onChange={saveField}
          onDelete={deleteField}
        />
      )}
    </div>
  );
}

function problem(reason, key) {
  switch (reason) {
    case "key_in_use":
      return `已有条目使用了 key「${key ?? ""}」，无法改名。先清空该字段的数据，或保留原来的 key。`;
    case "invalid_key":
      return "key 必须是小写字母开头，只能包含小写字母、数字和下划线。";
    case "invalid_type":
      return "字段类型不受支持。";
    case "not_found":
      return "没有找到这个集合或条目，可能已被删除。";
    case "empty":
      return "顺序不能为空。";
    default:
      return "操作失败，请重试。";
  }
}
