"use client";

/**
 * The page's frontmatter fields, as inputs.
 *
 * Smaller than the post editor's MetaPanel and deliberately so: a page's
 * frontmatter carries a title and a description and nothing else. No date, no
 * tags, no cover — a page is not in a feed or an archive, so none of those
 * fields have a meaning here.
 *
 * The distinction an author would otherwise get wrong is stated in the header:
 * editing these two boxes rewrites the document's frontmatter and therefore
 * creates a revision, while everything in PageSettings is a column on the
 * `pages` row and does not.
 */
export function PageMetaPanel({ meta, onChange, slug }) {
  const update = (key, value) => onChange({ ...meta, [key]: value });

  return (
    <div className="rounded-xl border border-border bg-surface">
      <div className="flex items-baseline justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-medium text-muted">属性</span>
        <span className="text-[11px] text-faint">写入 frontmatter</span>
      </div>

      <div className="space-y-3 p-3">
        <div>
          <label
            htmlFor="page-title"
            className="mb-1 block text-xs font-medium text-muted"
          >
            标题
          </label>
          <input
            id="page-title"
            type="text"
            value={meta.title ?? ""}
            onChange={(e) => update("title", e.target.value)}
            className={input}
            placeholder="关于作者"
          />
        </div>

        <div>
          <label
            htmlFor="page-description"
            className="mb-1 block text-xs font-medium text-muted"
          >
            摘要
          </label>
          <textarea
            id="page-description"
            rows={2}
            value={meta.description ?? ""}
            onChange={(e) => update("description", e.target.value)}
            className={`${input} resize-y`}
            placeholder="用于描述标签与搜索结果"
          />
        </div>

        {/*
          Read-only. A page's slug is a URL people type, so renaming it is a
          dialog with a redirect attached — not a text field beside the title
          where a stray keystroke retires a path.
        */}
        <div>
          <label
            htmlFor="page-meta-slug"
            className="mb-1 flex items-baseline justify-between text-xs font-medium text-muted"
          >
            路径
            <span className="font-normal text-faint">用上方的“路径”按钮修改</span>
          </label>
          <input
            id="page-meta-slug"
            type="text"
            value={`/${slug ?? ""}`}
            readOnly
            className={`${input} cursor-not-allowed font-mono text-xs text-faint`}
          />
        </div>
      </div>
    </div>
  );
}

const input =
  "w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-foreground " +
  "placeholder:text-faint transition-colors focus:border-accent focus:outline-none " +
  "focus-visible:ring-2 focus-visible:ring-accent/40";
