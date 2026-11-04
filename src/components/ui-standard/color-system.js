"use client";

import { useLayoutEffect, useRef, useState } from "react";
import {
  compositeOver,
  contrastRatio,
  formatColor,
  readVar,
  resolveColor,
  scopeTheme,
} from "../../lib/css-probe";

/**
 * The palette section of /UI.
 *
 * Two panels stand side by side: `Light` is scoped to :root, `Dark` to .dark.
 * Both scopes are built from the stylesheet itself (see lib/css-probe.js), so
 * the page shows the real values no matter which theme <html> currently has.
 * Every swatch is painted with the live `var(--token)`, every number is the
 * computed value, and text tokens additionally get their WCAG ratio against
 * that panel's `--background`.
 */

const GROUPS = [
  {
    title: "背景与表面",
    note: "页面底色与三档表面：白卡只出现在 --surface 上，输入框与复制字段用 --surface-2，内嵌块用 --surface-3。",
    rows: [
      { name: "--background", usage: "页面底色", kind: "color" },
      { name: "--surface", usage: "卡片 / 面板底色", kind: "color" },
      { name: "--surface-2", usage: "输入框、复制字段", kind: "color" },
      { name: "--surface-3", usage: "内嵌块、骨架屏", kind: "color" },
    ],
  },
  {
    title: "文字",
    note: "正文与元信息的四级文字。比率对当前面板的 --background 计算；--faint 允许低于 AA，因为它只承载别处也有的元信息。",
    rows: [
      { name: "--foreground", usage: "正文 / 标题", kind: "color", ratioTarget: "--background" },
      { name: "--muted", usage: "次要文字、excerpt", kind: "color", ratioTarget: "--background" },
      { name: "--faint", usage: "日期、计数等元信息", kind: "color", ratioTarget: "--background", lowOk: true },
      { name: "--accent", usage: "界面装饰文字（eyebrow、hover 标题）", kind: "color", ratioTarget: "--background" },
      { name: "--secondary", usage: "次级强调文字", kind: "color", ratioTarget: "--background" },
      { name: "--on-accent", usage: "主按钮上的文字", kind: "color", ratioTarget: "--accent-strong" },
    ],
  },
  {
    title: "主色与辅色",
    note: "填充色与 pastel 装饰色。承载文字的主按钮使用 --accent-strong → --secondary-strong 渐变；pastel 只做渐变与描边，不承载正文。",
    rows: [
      { name: "--accent-strong", usage: "主按钮/链接 ink", kind: "color" },
      { name: "--accent-soft", usage: "主色淡底", kind: "color" },
      { name: "--accent-pastel", usage: "淡紫装饰", kind: "color" },
      { name: "--secondary-strong", usage: "辅色 ink", kind: "color" },
      { name: "--secondary-soft", usage: "辅色淡底", kind: "color" },
      { name: "--secondary-pastel", usage: "淡粉装饰", kind: "color" },
      { name: "--sky", usage: "第四色（仅渐变与光标光）", kind: "color" },
      { name: "--color-brand-lavender", usage: "历史来源色，不直接消费", kind: "color" },
      { name: "--color-brand-pink", usage: "历史来源色，不直接消费", kind: "color" },
      { name: "--color-brand-stone", usage: "历史来源色，不直接消费", kind: "color" },
    ],
  },
  {
    title: "边框与投影",
    note: "1px 内描边就是本站在静止态的“高度”。阴影一律由 --shadow-tint 着色，随主题变化。",
    rows: [
      { name: "--border", usage: "分隔线 / 卡片内描边", kind: "color" },
      { name: "--border-strong", usage: "hover 时的中性描边", kind: "color" },
      { name: "--shadow-tint", usage: "阴影着色", kind: "color" },
      { name: "--shadow-card", usage: "静止卡片：1px 内描边", kind: "shadow" },
      { name: "--shadow-card-hover", usage: "hover / 浮起", kind: "shadow" },
      { name: "--shadow-pop", usage: "弹层 / 模态", kind: "shadow" },
    ],
  },
  {
    title: "渐变",
    note: "填充渐变给装饰块，文字渐变只能用于大字号（--gradient-brand-text）。首页 hero 只用底色，没有叠加光晕。",
    rows: [
      { name: "--gradient-brand", usage: "品牌填充渐变（三色）", kind: "gradient" },
      { name: "--gradient-brand-text", usage: "标题文字渐变", kind: "gradient" },
    ],
  },
  {
    title: "悬停系统（卡片 07 · 标签 C）",
    note: "颜色以裸 RGB 三元组存储：一套色同时驱动卡片的外圈 / 内描边 / 柔光，以及标签的外圈。标签另用三个 alpha token 分开控制静止底色、外圈和描边。",
    rows: [
      { name: "--glow-sky", usage: "青 · 外圈扇形 / 柔光外晕", kind: "triplet" },
      { name: "--glow-lav", usage: "紫 · 外圈扇形 / 柔光核心", kind: "triplet" },
      { name: "--glow-pink", usage: "粉 · 外圈扇形", kind: "triplet" },
      { name: "--glow-ring-a", usage: "外圈透明度", kind: "raw" },
      { name: "--glow-hairline-a", usage: "内描边透明度", kind: "raw" },
      { name: "--glow-glow-a", usage: "柔光核心透明度", kind: "raw" },
      { name: "--glow-glow-2-a", usage: "柔光外晕透明度", kind: "raw" },
      { name: "--glow-shadow", usage: "hover 的双层外投影 + 内描边", kind: "shadow" },
      { name: "--card-lift", usage: "hover 时卡片底色混入比例", kind: "raw" },
      { name: "--chip-wash-a", usage: "标签静止底色透明度", kind: "raw" },
      { name: "--chip-ring-a", usage: "标签外圈透明度（1px 线要更高）", kind: "raw" },
      { name: "--chip-hairline-a", usage: "标签静止描边透明度", kind: "raw" },
    ],
  },
];

const RING = "inset 0 0 0 1px color-mix(in srgb, var(--foreground) 14%, transparent)";

function swatchStyle(row) {
  switch (row.kind) {
    case "triplet":
      return { background: "rgb(var(" + row.name + "))" };
    case "gradient":
      return { backgroundImage: "var(" + row.name + ")" };
    case "shadow":
      return { background: "var(--surface)", boxShadow: "var(" + row.name + ")" };
    case "raw":
      return { background: "var(--surface-2)" };
    default:
      return { background: "var(" + row.name + ")" };
  }
}

function measureRow(scopeEl, row, decls) {
  if (row.kind === "color") {
    const color = resolveColor(scopeEl, row.name);
    let ratio = null;
    if (row.ratioTarget) {
      const bg = resolveColor(scopeEl, row.ratioTarget);
      if (color && bg) {
        const r = contrastRatio(compositeOver(color, bg), bg);
        const grade = r >= 4.5 ? "AA" : row.lowOk ? "辅助信息" : r >= 3 ? "AA 大字" : "未达 AA";
        ratio = { text: r.toFixed(2) + ":1 " + grade, pass: r >= 4.5 };
      }
    }
    return { value: formatColor(color), ratio };
  }
  if (row.kind === "gradient") return { value: "渐变 →", ratio: null };
  if (row.kind === "shadow") return { value: "阴影", ratio: null };
  return { value: decls.get(row.name) || readVar(scopeEl, row.name) || "—", ratio: null };
}

function Panel({ mode, label, scope, panelRef, values }) {
  return (
    <section
      ref={panelRef}
      className={mode === "dark" ? "dark min-w-0" : "min-w-0"}
      style={{
        background: "var(--background)",
        color: "var(--foreground)",
        borderRadius: "var(--radius-card)",
        boxShadow: RING,
        padding: "1rem",
      }}
    >
      <header className="flex items-center justify-between gap-3 border-b pb-3" style={{ borderColor: "var(--border)" }}>
        <div>
          <p className="text-sm font-semibold">{label}</p>
          <p className="mt-0.5 font-mono text-[0.7rem]" style={{ color: "var(--faint)" }}>
            {scope}
          </p>
        </div>
        <p className="text-[0.7rem]" style={{ color: "var(--muted)" }}>
          对比度对 --background
        </p>
      </header>
      <div className="mt-3 space-y-5">
        {GROUPS.map((group) => (
          <div key={group.title}>
            <p className="text-xs font-semibold" style={{ color: "var(--foreground)" }}>
              {group.title}
            </p>
            <p className="mt-0.5 text-[0.7rem] leading-4" style={{ color: "var(--muted)" }}>
              {group.note}
            </p>
            <ul className="mt-2">
              {group.rows.map((row) => {
                const cell = values[row.name]?.[mode];
                return (
                  <li key={row.name} className="flex items-start gap-2.5 py-1">
                    <span
                      aria-hidden="true"
                      className="mt-0.5 block h-8 w-8 shrink-0"
                      style={{
                        borderRadius: "0.3125rem",
                        ...swatchStyle(row),
                        ...(row.kind === "shadow" ? {} : { boxShadow: RING }),
                      }}
                    />
                    <div className="min-w-0">
                      <p className="font-mono text-[0.72rem] leading-4">{row.name}</p>
                      <p className="text-[0.7rem] leading-4" style={{ color: "var(--muted)" }}>
                        {row.usage}
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 font-mono text-[0.7rem] leading-4" style={{ color: "var(--faint)" }}>
                        <span>{cell ? cell.value : "读取中…"}</span>
                        {cell?.ratio ? (
                          <span style={{ color: cell.ratio.pass ? "var(--accent)" : "var(--faint)" }}>
                            {cell.ratio.text}
                          </span>
                        ) : null}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function ColorSystem() {
  const lightRef = useRef(null);
  const darkRef = useRef(null);
  const [values, setValues] = useState({});

  useLayoutEffect(() => {
    const lightEl = lightRef.current;
    const darkEl = darkRef.current;
    if (!lightEl || !darkEl) return;
    const lightDecls = scopeTheme(lightEl, ":root");
    const darkDecls = scopeTheme(darkEl, ".dark") || new Map();
    const next = {};
    for (const group of GROUPS) {
      for (const row of group.rows) {
        next[row.name] = {
          light: measureRow(lightEl, row, lightDecls),
          dark: measureRow(darkEl, row, darkDecls.size ? darkDecls : lightDecls),
        };
      }
    }
    setValues(next);
  }, []);

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <Panel mode="light" label="Light 模式" scope=":root" panelRef={lightRef} values={values} />
      <Panel mode="dark" label="Dark 模式" scope=".dark" panelRef={darkRef} values={values} />
    </div>
  );
}
