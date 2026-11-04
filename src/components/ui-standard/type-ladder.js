"use client";

import { useLayoutEffect, useRef, useState } from "react";

/**
 * Typography ladder, measured from the rendered specimens.
 *
 * The `--text-*` tokens live in Tailwind's `@theme inline` block, which does
 * not emit custom properties at runtime (the utilities inline the value), so
 * this section reads `font-size` / `line-height` off the elements themselves:
 * what is shown is literally what these classes compute to on this browser.
 */

const ROWS = [
  { label: "Display", className: "text-display", note: "首页大标题（仅一处）" },
  { label: "H1", className: "text-h1", note: "页面主标题" },
  { label: "H2", className: "text-h2", note: "文章内二级标题" },
  { label: "Title", className: "text-title", note: "区块标题" },
  { label: "Lead", className: "text-lead", note: "导语 / 描述" },
  { label: "Base", className: "text-base", note: "正文" },
  { label: "SM", className: "text-sm", note: "卡片摘要、控件" },
  { label: "Caption", className: "text-caption", note: "日期、标签、eyebrow" },
];

export default function TypeLadder() {
  const nodes = useRef({});
  const [measured, setMeasured] = useState({ metrics: {}, family: "" });

  useLayoutEffect(() => {
    const next = {};
    for (const row of ROWS) {
      const el = nodes.current[row.className];
      if (!el) continue;
      const cs = getComputedStyle(el);
      next[row.className] = {
        size: parseFloat(cs.fontSize),
        lineHeight: parseFloat(cs.lineHeight),
        weight: cs.fontWeight,
        tracking: cs.letterSpacing,
      };
    }
    const first = Object.values(nodes.current)[0];
    const resolvedFamily = first
      ? getComputedStyle(first).fontFamily.split(",")[0].replaceAll('"', "")
      : "";
    // Deferred one frame: this effect is reading the DOM (an external system),
    // and the lint rule for React 19 rejects a synchronous setState in an
    // effect body because it causes a second render pass in the same commit.
    const raf = requestAnimationFrame(() => setMeasured({ metrics: next, family: resolvedFamily }));
    return () => cancelAnimationFrame(raf);
  }, []);

  const { metrics, family } = measured;

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-3">
        <p className="font-mono text-xs text-faint">字号阶梯 · 8 级 / 4px 基线体系</p>
        <p className="text-xs text-muted">
          字体栈首项：<span className="font-mono text-foreground">{family || "读取中…"}</span>
          <span className="ml-2 text-faint">· 只使用系统字体，整站 0 个 webfont 请求</span>
        </p>
      </div>
      <ul className="mt-1 divide-y divide-border">
        {ROWS.map((row) => {
          const metric = metrics[row.className];
          return (
            <li key={row.className} className="grid grid-cols-1 items-baseline gap-x-4 gap-y-1 py-4 md:grid-cols-[6rem_1fr_13rem]">
              <div>
                <p className="font-mono text-[0.72rem] text-accent">{row.label}</p>
                <p className="text-[0.7rem] text-faint">{row.note}</p>
              </div>
              <p
                ref={(el) => {
                  nodes.current[row.className] = el;
                }}
                className={row.className + " truncate font-semibold tracking-tight text-foreground"}
              >
                设计系统 Design System 0123
              </p>
              <p className="font-mono text-[0.7rem] leading-4 text-muted md:text-right">
                {metric
                  ? `${metric.size.toFixed(1)}px / ${metric.lineHeight.toFixed(1)}px · w${metric.weight} · ls ${parseFloat(metric.tracking).toFixed(2)}px`
                  : "读取中…"}
                <span className="mt-0.5 block text-faint">{"." + row.className}</span>
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
