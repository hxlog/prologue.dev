"use client";

import { useState } from "react";

import { IconClose, IconPlus } from "../../../../../components/studio/icons";

/**
 * The field definitions.
 *
 * ## Two shapes, and only one of them is editable in place
 *
 * A LABEL is free to change at any time — nothing is stored against it. A KEY
 * is not: `values` is keyed by it, so renaming one orphans every value already
 * stored under the old name. The server refuses a key change once any entry has
 * that key (see `saveField`), and this screen reflects that rather than letting
 * the author discover it by being told no.
 *
 * ## What the options box means per type
 *
 * Only `select` uses it, as a comma-separated list of choices. It is shown for
 * that type alone, because a box that does nothing on six of eight controls
 * teaches the author to ignore it on the seventh.
 */
export default function FieldsTab({ fields, onChange, onDelete, pending }) {
  const [draft, setDraft] = useState({ key: "", label: "", type: "text" });
  const [expanded, setExpanded] = useState(null);

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
        {fields.length === 0 && (
          <li className="px-4 py-10 text-center text-sm text-faint">
            这个集合还没有字段，下面添加第一个。
          </li>
        )}

        {fields.map((field) => {
          const open = expanded === field.id;
          return (
            <li key={field.id} className="px-3 py-2.5">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : field.id)}
                  aria-expanded={open}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="truncate text-sm text-foreground">
                      {field.label}
                    </span>
                    <span className="font-mono text-[11px] text-faint">
                      {field.key}
                    </span>
                    {field.required && <span className="text-[11px] text-red-500">必填</span>}
                  </p>
                  <p className="mt-0.5 text-[11px] text-faint">{field.type}</p>
                </button>

                <button
                  type="button"
                  disabled={pending}
                  onClick={() => onDelete(field)}
                  aria-label={`删除字段 ${field.label}`}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-faint transition-colors hover:bg-surface-3 hover:text-red-500 disabled:opacity-40"
                >
                  <IconClose className="h-3.5 w-3.5" />
                </button>
              </div>

              {open && (
                <FieldForm
                  field={field}
                  pending={pending}
                  onSubmit={(input) => {
                    onChange(field.id, input);
                    setExpanded(null);
                  }}
                  onCancel={() => setExpanded(null)}
                />
              )}
            </li>
          );
        })}
      </ul>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.key.trim() && !draft.label.trim()) return;
          onChange(null, {
            key: draft.key || draft.label,
            label: draft.label || draft.key,
            type: draft.type,
          });
          setDraft({ key: "", label: "", type: "text" });
        }}
        className="rounded-xl border border-border bg-surface p-3"
      >
        <p className="mb-2 text-xs font-medium text-muted">添加字段</p>
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
          <input
            type="text"
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            placeholder="名称"
            aria-label="字段名称"
            className={input}
          />
          <input
            type="text"
            value={draft.key}
            onChange={(e) => setDraft({ ...draft, key: e.target.value })}
            placeholder="key（留空则用名称）"
            aria-label="字段 key"
            className={`${input} font-mono text-xs`}
          />
          <select
            value={draft.type}
            onChange={(e) => setDraft({ ...draft, type: e.target.value })}
            aria-label="字段类型"
            className={input}
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <IconPlus className="h-4 w-4" />
            添加
          </button>
        </div>

        {/*
          The key is what `values` is keyed by, so it is worth one sentence of
          explanation rather than a tooltip nobody opens.
        */}
        <p className="mt-2 text-[11px] leading-5 text-faint">
          key 是数据存储使用的名字，用英文小写字母与下划线。已经有数据的 key
          不能改名——那会让已有的值找不到归属。
        </p>
      </form>
    </div>
  );
}

function FieldForm({ field, onSubmit, onCancel, pending }) {
  const [input, setInput] = useState({
    key: field.key,
    label: field.label,
    type: field.type,
    required: field.required === true,
    helpText: field.help_text ?? "",
    choices: choicesOf(field.options),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          key: input.key,
          label: input.label,
          type: input.type,
          required: input.required,
          helpText: input.helpText,
          options: input.type === "select" ? { choices: input.choices } : {},
        });
      }}
      className="mt-3 space-y-2 border-t border-border pt-3"
    >
      <div className="grid gap-2 sm:grid-cols-3">
        <Labelled label="名称">
          <input
            type="text"
            value={input.label}
            onChange={(e) => setInput({ ...input, label: e.target.value })}
            className={input_}
          />
        </Labelled>
        <Labelled label="key">
          <input
            type="text"
            value={input.key}
            onChange={(e) => setInput({ ...input, key: e.target.value })}
            className={`${input_} font-mono text-xs`}
          />
        </Labelled>
        <Labelled label="类型">
          <select
            value={input.type}
            onChange={(e) => setInput({ ...input, type: e.target.value })}
            className={input_}
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Labelled>
      </div>

      {input.type === "select" && (
        <Labelled label="选项" hint="用英文逗号分隔">
          <input
            type="text"
            value={input.choices}
            onChange={(e) => setInput({ ...input, choices: e.target.value })}
            placeholder="草稿, 已发布"
            className={input_}
          />
        </Labelled>
      )}

      <Labelled label="说明" hint="显示在输入框下方">
        <input
          type="text"
          value={input.helpText}
          onChange={(e) => setInput({ ...input, helpText: e.target.value })}
          className={input_}
        />
      </Labelled>

      <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
        <input
          type="checkbox"
          checked={input.required}
          onChange={(e) => setInput({ ...input, required: e.target.checked })}
          className="h-4 w-4 rounded border-border text-accent focus:ring-accent/40"
        />
        必填
      </label>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={ghost}>
          取消
        </button>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          保存
        </button>
      </div>
    </form>
  );
}

/** The type list, spelled out so the select is stable across renders. */
const TYPES = [
  "text",
  "long_text",
  "number",
  "date",
  "url",
  "image",
  "image_gallery",
  "boolean",
  "select",
];

function choicesOf(options) {
  if (!options) return "";
  const choices = options.choices;
  if (Array.isArray(choices)) return choices.join(", ");
  if (typeof choices === "string") return choices;
  return "";
}

function Labelled({ label, hint, children }) {
  return (
    <div>
      <span className="mb-1 flex items-baseline justify-between text-[11px] font-medium text-faint">
        {label}
        {hint && <span className="font-normal">{hint}</span>}
      </span>
      {children}
    </div>
  );
}

const ghost =
  "rounded-lg border border-border px-3 py-1.5 text-xs text-muted transition-colors " +
  "hover:bg-surface-2 hover:text-accent disabled:opacity-50";

const input_ =
  "w-full rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm text-foreground " +
  "placeholder:text-faint transition-colors focus:border-accent focus:outline-none " +
  "focus-visible:ring-2 focus-visible:ring-accent/40";

const input =
  "w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-foreground " +
  "placeholder:text-faint transition-colors focus:border-accent focus:outline-none " +
  "focus-visible:ring-2 focus-visible:ring-accent/40";
