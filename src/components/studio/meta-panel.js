"use client";

import { useMemo, useState } from "react";

/**
 * The metadata sidebar.
 *
 * These fields are not a form beside the document — they ARE the document, or
 * the frontmatter block of it. `patchMeta` writes them back into the text and
 * leaves every untouched line byte-identical (verified across all 64 documents
 * by scripts/db/check-frontmatter-roundtrip.mjs), so editing a title here is
 * indistinguishable from editing that line in the editor.
 *
 * ## Why the fields are merged, not appended
 *
 * A naive implementation stores the eight fields separately and re-serialises
 * the block on save. That cannot round-trip: the corpus writes its keys in at
 * least three different orders, so any canonical ordering would rewrite every
 * frontmatter block in the blog the first time a post was opened. Here, a field
 * the author does not touch is re-emitted from its original source text.
 *
 * ## Tag input
 *
 * A text field with comma separation, backed by a datalist of the known
 * taxonomy. Not a multi-select: the taxonomy is 15 tags and the author knows
 * them, and a dropdown forces a mouse. Unknown tags are reported on save rather
 * than silently created, because the taxonomy is curated and a typo inventing a
 * 16th tag is how a taxonomy rots.
 */

export function MetaPanel({ meta, onChange, knownTags = [], slug }) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const update = (key, value) => onChange({ ...meta, [key]: value });

  const tagText = useMemo(
    () => (Array.isArray(meta.tags) ? meta.tags.join(", ") : ""),
    [meta.tags]
  );

  return (
    <div className="rounded-xl border border-border bg-surface">
      <div className="border-b border-border px-3 py-2">
        <span className="text-xs font-medium text-muted">属性</span>
      </div>

      <div className="space-y-3 p-3">
        <Field label="标题" htmlFor="meta-title">
          <input
            id="meta-title"
            type="text"
            value={meta.title ?? ""}
            onChange={(e) => update("title", e.target.value)}
            className={input}
            placeholder="文章标题"
          />
        </Field>

        <Field label="摘要" htmlFor="meta-description">
          <textarea
            id="meta-description"
            rows={2}
            value={meta.description ?? ""}
            onChange={(e) => update("description", e.target.value)}
            className={`${input} resize-y`}
            placeholder="一句话描述，用于列表卡片与搜索结果"
          />
        </Field>

        <Field label="标签" htmlFor="meta-tags" hint="用英文逗号分隔">
          <input
            id="meta-tags"
            type="text"
            value={tagText}
            onChange={(e) =>
              update(
                "tags",
                e.target.value
                  .split(",")
                  .map((t) => t.trim())
                  .filter(Boolean)
              )
            }
            className={input}
            list="studio-known-tags"
            placeholder="Economics, Finance"
          />
          <datalist id="studio-known-tags">
            {knownTags.map((t) => (
              <option key={t.slug} value={t.slug}>
                {t.label}
              </option>
            ))}
          </datalist>
        </Field>

        {/*
          Stacked on a phone, two-up from `sm`. A native `<input type="date">`
          has a browser-defined intrinsic width that does not shrink below its
          rendered text plus the picker button, so two of them side by side in
          the ~160px each gets at 375px is where the second one starts clipping
          its own calendar affordance.
        */}
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="发布日期" htmlFor="meta-publish-date">
            <input
              id="meta-publish-date"
              type="date"
              value={asDateInput(meta.publishDate)}
              onChange={(e) => update("publishDate", e.target.value)}
              className={input}
            />
          </Field>
          <Field label="更新日期" htmlFor="meta-lastmod">
            <input
              id="meta-lastmod"
              type="date"
              value={asDateInput(meta.lastmod)}
              onChange={(e) => update("lastmod", e.target.value)}
              className={input}
            />
          </Field>
        </div>

        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          aria-expanded={showAdvanced}
          className="text-xs text-faint transition-colors hover:text-accent"
        >
          {showAdvanced ? "收起封面与选项" : "封面与选项"}
        </button>

        {showAdvanced && (
          <div className="space-y-3 border-t border-border pt-3">
            <Field label="封面图" htmlFor="meta-image">
              <input
                id="meta-image"
                type="text"
                value={meta.image ?? ""}
                onChange={(e) => update("image", e.target.value)}
                className={input}
                placeholder="/static/photos/…"
              />
            </Field>

            <Field label="封面说明" htmlFor="meta-image-desc">
              <input
                id="meta-image-desc"
                type="text"
                value={meta.imageDesc ?? ""}
                onChange={(e) => update("imageDesc", e.target.value)}
                className={input}
                placeholder="封面图下的说明文字"
              />
            </Field>

            <Toggle
              id="meta-featured"
              label="首页推荐"
              checked={meta.featured === true}
              onChange={(v) => update("featured", v)}
            />

            {/*
              Slug is shown read-only rather than editable. Renaming a slug
              writes to slug_history and needs its own confirmation step with
              the redirect it implies; burying that in a text field beside the
              title would make it a one-keystroke way to break every inbound
              link to a post.
            */}
            <Field label="路径" htmlFor="meta-slug">
              <input
                id="meta-slug"
                type="text"
                value={slug ?? ""}
                readOnly
                className={`${input} cursor-not-allowed text-faint`}
              />
            </Field>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * A Date, or a JS `Date`, or an empty string, as `YYYY-MM-DD`.
 *
 * `readMeta` already normalises to the string form; this is the belt to that
 * braces, and it exists because a date-only `<input>` silently renders blank
 * for any other format — so a value that arrived as a Date would look like the
 * field had been cleared, and the next save would delete the date.
 */
function asDateInput(value) {
  if (!value) return "";
  if (value instanceof Date) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, "0");
    const d = String(value.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const text = String(value);
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (!m) return "";
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

function Field({ label, htmlFor, hint, children }) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="mb-1 flex items-baseline justify-between text-xs font-medium text-muted"
      >
        {label}
        {hint && <span className="font-normal text-faint">{hint}</span>}
      </label>
      {children}
    </div>
  );
}

function Toggle({ id, label, checked, onChange }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center gap-2 text-xs text-muted">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-border text-accent focus:ring-accent/40"
      />
      {label}
    </label>
  );
}

const input =
  "w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-foreground " +
  "placeholder:text-faint transition-colors focus:border-accent focus:outline-none " +
  "focus-visible:ring-2 focus-visible:ring-accent/40";
