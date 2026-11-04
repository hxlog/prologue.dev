"use client";

import { useState } from "react";

/**
 * Motion previews. `.reveal-rise` is the entrance for content that appears
 * after first paint (load more, search results); `.toc-pill` is the outline
 * marker. Both are CSS animations, so "replay" is a remount with a new key.
 */
export default function RevealDemo() {
  const [run, setRun] = useState(0);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted">
          两个动画皆为纯 CSS，无动画库；重播 = 重新挂载节点。
        </p>
        <button type="button" className="btn btn-ghost h-8" onClick={() => setRun((n) => n + 1)}>
          重播动效
        </button>
      </div>

      <div key={run} className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="reveal-rise card p-4">
          <p className="font-mono text-[0.72rem] text-accent">.reveal-rise</p>
          <p className="mt-1 text-sm text-foreground">入场：上移 6px + 淡入</p>
          <p className="mt-1 text-[0.7rem] text-faint">
            var(--duration-enter) 260ms · var(--ease-out-expo)
          </p>
        </div>
        <div className="reveal-rise card flex items-center gap-3 p-4">
          <span className="toc-pill inline-flex items-center gap-2 rounded-(--radius-pill) bg-surface-2 px-3 py-1.5 text-sm text-accent">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            当前小节
          </span>
          <p className="font-mono text-[0.72rem] text-faint">.toc-pill</p>
        </div>
      </div>
    </div>
  );
}
