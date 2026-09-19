"use client";

/**
 * The page's own presentation settings.
 *
 * Four things that are NOT part of the document and deliberately so: they
 * describe the page as a URL, not a version of its text. A page restored to an
 * older revision should not silently get its old comment setting back, and
 * toggling comments should not read as "the content changed" on the history
 * screen. So they live on the `pages` row, they are written by the same save,
 * and they are shown here rather than in the frontmatter.
 *
 * ## Custom CSS
 *
 * A textarea rather than a file, because there is no file system in production.
 * It is scoped by the layout that injects it, so it can restyle a page without
 * touching the rest of the site — which is the only reason a per-page escape
 * hatch is safe to offer at all.
 *
 * The warning below the field is not decoration. An unclosed brace in this box
 * takes out the whole page, and CSS fails silently, so the author would be
 * looking at unstyled content with no error anywhere to explain it.
 */

export function PageSettings({ settings, onChange }) {
  const update = (key, value) => onChange({ ...settings, [key]: value });

  return (
    <div className="rounded-xl border border-border bg-surface">
      <div className="border-b border-border px-3 py-2">
        <span className="text-xs font-medium text-muted">页面设置</span>
      </div>

      <div className="space-y-3 p-3">
        <Toggle
          id="page-giscus"
          label="启用评论"
          hint="Giscus"
          checked={settings.giscusEnabled !== false}
          onChange={(v) => update("giscusEnabled", v)}
        />

        <Toggle
          id="page-nav"
          label="显示在导航栏"
          hint="顶部菜单"
          checked={settings.showInNav === true}
          onChange={(v) => update("showInNav", v)}
        />

        {settings.showInNav && (
          <div>
            <label
              htmlFor="page-nav-label"
              className="mb-1 block text-xs font-medium text-muted"
            >
              导航显示名
            </label>
            <input
              id="page-nav-label"
              type="text"
              value={settings.navLabel ?? ""}
              onChange={(e) => update("navLabel", e.target.value)}
              placeholder="留空则使用标题"
              className={input}
            />
          </div>
        )}

        <div>
          <label
            htmlFor="page-css"
            className="mb-1 flex items-baseline justify-between text-xs font-medium text-muted"
          >
            自定义 CSS
            <span className="font-normal text-faint">仅作用于本页</span>
          </label>
          <textarea
            id="page-css"
            rows={6}
            value={settings.customCss ?? ""}
            onChange={(e) => update("customCss", e.target.value)}
            spellCheck={false}
            placeholder={".prose h2 { letter-spacing: -0.02em; }"}
            className={`${input} resize-y font-mono text-xs`}
          />
          <p className="mt-1.5 text-[11px] leading-5 text-faint">
            括号必须闭合。CSS 出错时不会报错，只会让页面样式失效。
          </p>
        </div>
      </div>
    </div>
  );
}

function Toggle({ id, label, hint, checked, onChange }) {
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-center justify-between gap-2 text-xs text-muted"
    >
      <span className="flex items-baseline gap-1.5">
        {label}
        {hint && <span className="text-[11px] text-faint">{hint}</span>}
      </span>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-border text-accent focus:ring-accent/40"
      />
    </label>
  );
}

const input =
  "w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-foreground " +
  "placeholder:text-faint transition-colors focus:border-accent focus:outline-none " +
  "focus-visible:ring-2 focus-visible:ring-accent/40";
