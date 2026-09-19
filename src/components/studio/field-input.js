"use client";

/**
 * One control per field type.
 *
 * ## Why the value shapes are fixed here
 *
 * `collection_entries.values` is JSONB, so nothing in the database enforces a
 * shape — which means the studio is the only place that decides what a gallery
 * looks like. It is `[{src, desc}]`, an image is `{src, alt}`, and a date is a
 * `YYYY-MM-DD` string. Every one of those choices exists because something
 * downstream already reads the value that way: the gallery is the shape
 * `MicroblogCard` renders, and the date string is what `contentDateISO` accepts
 * and what the microblog's `date` field has held since the import.
 *
 * The coercion is duplicated in `coerceValues` on the server, deliberately —
 * the server must not trust what the browser sends, and the browser must not be
 * the only thing that knows the shape.
 *
 * ## Galleries
 *
 * A gallery is a list of rows, each a path and a description. Not a drop zone:
 * there is no media library yet, and a control that pretends to upload would be
 * worse than a text field that says what it wants. When the library lands this
 * is the component that gains a picker.
 */

export function FieldInput({ field, value, onChange, disabled }) {
  const id = `field-${field.key}`;

  return (
    <div>
      <label htmlFor={id} className="mb-1 flex items-baseline gap-1.5 text-xs font-medium text-muted">
        {field.label}
        {field.required && <span className="text-danger">*</span>}
        <span className="font-normal text-faint">{typeLabel(field.type)}</span>
      </label>

      <Control field={field} value={value} onChange={onChange} disabled={disabled} id={id} />

      {field.help_text && (
        <p className="mt-1 text-[11px] text-faint">{field.help_text}</p>
      )}
    </div>
  );
}

function Control({ field, value, onChange, disabled, id }) {
  const common = { id, disabled, className: input };

  switch (field.type) {
    case "long_text":
      return (
        <textarea
          {...common}
          rows={field.key === "content" ? 4 : 3}
          value={asString(value)}
          onChange={(e) => onChange(e.target.value)}
          className={`${input} resize-y`}
        />
      );

    case "number":
      return (
        <input
          {...common}
          type="number"
          value={value === null || value === undefined ? "" : String(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "date":
      return (
        <input
          {...common}
          type="date"
          value={asDate(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "url":
      return (
        <input
          {...common}
          type="url"
          inputMode="url"
          value={asString(value)}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://"
          className={`${input} font-mono text-xs`}
        />
      );

    case "boolean":
      return (
        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted">
          <input
            id={id}
            type="checkbox"
            disabled={disabled}
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
            className="h-4 w-4 rounded border-border text-accent focus:ring-accent/40"
          />
          {value === true ? "开" : "关"}
        </label>
      );

    case "select": {
      const choices = selectOptions(field.options);
      return (
        <select
          {...common}
          value={asString(value)}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">—</option>
          {choices.map((choice) => (
            <option key={choice} value={choice}>
              {choice}
            </option>
          ))}
        </select>
      );
    }

    case "image":
      return (
        <ImageRow
          id={id}
          disabled={disabled}
          value={asImage(value)}
          onChange={onChange}
        />
      );

    case "image_gallery":
      return (
        <Gallery
          disabled={disabled}
          value={Array.isArray(value) ? value : []}
          onChange={onChange}
        />
      );

    default:
      return (
        <input
          {...common}
          type="text"
          value={asString(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

function ImageRow({ id, value, onChange, disabled }) {
  return (
    <div className="flex gap-2">
      <input
        id={id}
        type="text"
        disabled={disabled}
        value={value.src}
        onChange={(e) => onChange({ ...value, src: e.target.value })}
        placeholder="/static/photos/…"
        className={`${input} font-mono text-xs`}
      />
      <input
        type="text"
        disabled={disabled}
        value={value.alt}
        onChange={(e) => onChange({ ...value, alt: e.target.value })}
        placeholder="替代文字"
        className={`${input} max-w-[40%]`}
      />
    </div>
  );
}

function Gallery({ value, onChange, disabled }) {
  const rows = value.map((item) =>
    typeof item === "string" ? { src: item, desc: "" } : { src: item.src ?? "", desc: item.desc ?? "" }
  );

  const update = (index, patch) => {
    const next = [...rows];
    next[index] = { ...next[index], ...patch };
    onChange(next);
  };

  return (
    <div className="space-y-2">
      {rows.map((row, index) => (
        <div key={index} className="flex gap-2">
          <input
            type="text"
            disabled={disabled}
            value={row.src}
            onChange={(e) => update(index, { src: e.target.value })}
            placeholder="/static/photos/…"
            aria-label={`第 ${index + 1} 张图片`}
            className={`${input} font-mono text-xs`}
          />
          <input
            type="text"
            disabled={disabled}
            value={row.desc}
            onChange={(e) => update(index, { desc: e.target.value })}
            placeholder="说明"
            aria-label={`第 ${index + 1} 张图片说明`}
            className={`${input} max-w-[35%]`}
          />
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
            aria-label={`删除第 ${index + 1} 张图片`}
            className="shrink-0 rounded-lg border border-border px-2 text-xs text-faint transition-colors hover:text-danger disabled:opacity-40"
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange([...rows, { src: "", desc: "" }])}
        className="rounded-lg border border-dashed border-border px-3 py-1.5 text-xs text-faint transition-colors hover:border-accent hover:text-accent disabled:opacity-40"
      >
        + 添加图片
      </button>
    </div>
  );
}

const TYPE_LABELS = {
  text: "短文本",
  long_text: "长文本",
  number: "数字",
  date: "日期",
  url: "网址",
  image: "图片",
  image_gallery: "图片组",
  boolean: "开关",
  select: "单选",
};

function typeLabel(type) {
  return TYPE_LABELS[type] ?? type;
}

/** `options.choices`, or a comma-separated `options` string; both are accepted. */
function selectOptions(options) {
  if (!options) return [];
  if (Array.isArray(options.choices)) return options.choices.map(String);
  if (typeof options.choices === "string") {
    return options.choices.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function asString(value) {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : String(value);
}

/**
 * A `YYYY-MM-DD` for the date input.
 *
 * UTC accessors, not local ones: a value stored as `2026-09-05T00:00:00.000Z`
 * read with `getDate()` in a UTC-5 browser gives the 4th, and the author would
 * see yesterday's date in the field and save it back. The same reasoning as
 * src/lib/studio/frontmatter-doc.js.
 */
function asDate(value) {
  if (!value) return "";
  const text = String(value);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
}

function asImage(value) {
  if (!value) return { src: "", alt: "" };
  if (typeof value === "string") return { src: value, alt: "" };
  return { src: String(value.src ?? ""), alt: String(value.alt ?? "") };
}

const input =
  "w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-foreground " +
  "placeholder:text-faint transition-colors focus:border-accent focus:outline-none " +
  "focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-60";
