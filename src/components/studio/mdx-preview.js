"use client";

import MDXRenderer from "../mdx-renderer";

/**
 * The page preview.
 *
 * A page is not a markdown document with extras — its source contains JSX, and
 * the artifact a reader's browser receives is a compiled component, not markup.
 * So the only honest preview is to compile the source and evaluate the result
 * with the same `MDXRenderer` the public route uses. Anything else would be a
 * preview of a different pipeline.
 *
 * ## Why the commit is deferred
 *
 * `renderPagePreview` is a server round trip, and it runs on a debounce while
 * the author types. Between the keystroke and the reply the stored code is
 * still the previous one, so an intermediate document is never shown — the
 * pane swaps from one compiled revision to the next, rather than flickering
 * through states that were never saved and never will be.
 *
 * ## Compile errors
 *
 * MDX fails as a whole or not at all: one unbalanced tag and there is no
 * component to render. So an error replaces the preview rather than decorating
 * it, and the message is the compiler's own — it names the line and the
 * character, which is the only part of a parse error worth reading.
 */
export function MdxPreview({ code, error, empty }) {
  if (error) {
    return (
      <div className="rounded-xl border border-danger/30 bg-danger-soft p-4">
        <p className="text-xs font-medium text-danger">MDX 无法编译</p>
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-5 text-danger/90">
          {error}
        </pre>
        <p className="mt-3 text-xs text-muted">
          预览显示的是上一次成功编译的版本。修好语法后会自动更新。
        </p>
      </div>
    );
  }

  if (!code) {
    return (
      <p className="rounded-xl border border-border bg-surface px-4 py-12 text-center text-sm text-faint">
        {empty ?? "还没有内容。"}
      </p>
    );
  }

  return (
    <article className="prose dark:prose-invert max-w-[78ch]">
      <MDXRenderer code={code} />
    </article>
  );
}
