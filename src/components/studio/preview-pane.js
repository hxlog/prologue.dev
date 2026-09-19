"use client";

import { useState } from "react";
import { OptimizedHTMLRenderer } from "../optimized-html-renderer";

/**
 * The preview pane.
 *
 * ## What makes this "exactly what will be published"
 *
 * The HTML is not rendered here — it is rendered on the SERVER by
 * `renderMarkdown`, the same function that produced the stored revision, and
 * handed down. This component only chooses how to display it, and it uses the
 * same `OptimizedHTMLRenderer` the post page uses, so `<img>` becomes
 * `next/image` and `<pre class="mermaid">` becomes a live diagram in both
 * places rather than only in one.
 *
 * That is the whole reason a source editor was chosen over a WYSIWYG one:
 * there is no second pipeline here to drift. A preview built on a different
 * markdown renderer would look right on the day it was written and diverge on
 * the first plugin change — which is precisely what happened to the site this
 * replaces.
 *
 * ## The width switch
 *
 * Post bodies are capped at 78ch on the public site (see globals.css), and a
 * preview rendered at the pane's natural width would wrap differently and hide
 * exactly the problem the preview exists to catch: an image that overflows, a
 * table that is too wide, a line that reads badly. So the pane can render at
 * the real reading width, and says so.
 */

const WIDTHS = [
  { key: "reading", label: "阅读宽度", className: "max-w-[78ch]" },
  { key: "full", label: "整宽", className: "max-w-none" },
];

export function PreviewPane({ html, emptyHint }) {
  const [width, setWidth] = useState("reading");

  const active = WIDTHS.find((w) => w.key === width) ?? WIDTHS[0];

  /*
    The toolbar is hidden when the pane is standing in for the whole page — on
    a phone the preview IS the screen, and a "整宽 / 阅读宽度" toggle there is a
    control that does nothing.
  */
  const showToolbar = html !== undefined;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      {showToolbar && (
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-xs font-medium text-muted">预览</span>
          <div className="flex gap-1 rounded-lg bg-surface-2 p-0.5">
            {WIDTHS.map((w) => (
              <button
                key={w.key}
                type="button"
                onClick={() => setWidth(w.key)}
                aria-pressed={width === w.key}
                className={`rounded-md px-2 py-1 text-[11px] transition-colors ${
                  width === w.key
                    ? "bg-surface font-medium text-foreground shadow-sm"
                    : "text-faint hover:text-muted"
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="max-h-[calc(100vh-12rem)] overflow-y-auto px-4 py-4 sm:px-6">
        {html ? (
          /*
            The `prose` classes are the public site's own, so headings, code
            blocks, blockquotes, tables and KaTeX all inherit the exact styling
            a reader sees. Rebuilding that CSS here would be a second design
            system, and the first thing to fall out of sync.
          */
          <article className={`prose dark:prose-invert mx-auto ${active.className}`}>
            <OptimizedHTMLRenderer htmlContent={html} />
          </article>
        ) : (
          <p className="py-10 text-center text-sm text-faint">
            {emptyHint ?? "还没有内容。"}
          </p>
        )}
      </div>
    </div>
  );
}
