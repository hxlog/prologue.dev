"use client";

import { useEffect, useState } from "react";

/**
 * Zero-image decoration: a fake terminal that typewriter-types rotating
 * quotes (fed from the microblog entries). Purely client-side, ~1.5KB,
 * and disabled under prefers-reduced-motion (via MotionConfig-independent
 * check here because it's plain state).
 */
export default function TerminalQuotes({ quotes }) {
  const [index, setIndex] = useState(0);
  const [chars, setChars] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);

  const quote = quotes[index % Math.max(quotes.length, 1)] || "";

  // Detect reduced-motion after mount (async to keep the effect lint-clean).
  useEffect(() => {
    const timer = setTimeout(() => {
      if (typeof window !== "undefined") {
        setReduced(
          window.matchMedia("(prefers-reduced-motion: reduce)").matches
        );
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !quote || reduced) return;

    if (chars < quote.length) {
      const timer = setTimeout(() => setChars((c) => c + 1), 46);
      return () => clearTimeout(timer);
    }

    // Hold the completed quote, then advance.
    if (!paused) {
      const hold = setTimeout(() => setPaused(true), 2600);
      return () => clearTimeout(hold);
    }
    const next = setTimeout(() => {
      setPaused(false);
      setChars(0);
      setIndex((i) => (i + 1) % quotes.length);
    }, 400);
    return () => clearTimeout(next);
  }, [chars, paused, quote, quotes.length, reduced]);

  if (!quote) return null;

  const shown = reduced ? quote : quote.slice(0, chars);

  return (
    <div className="terminal mt-6" aria-hidden="true">
      <div className="terminal-bar">
        <span className="terminal-dot" style={{ background: "#f87171" }} />
        <span className="terminal-dot" style={{ background: "#fbbf24" }} />
        <span className="terminal-dot" style={{ background: "#34d399" }} />
        <span className="ml-2 text-xs text-faint">序章 · 随想</span>
      </div>
      <div className="min-h-[5.5rem] px-4 py-3 text-[13px] leading-6 text-muted">
        <span className="mr-1 select-none text-accent">❯</span>
        {shown}
        {!reduced && <span className="terminal-cursor ml-0.5 align-middle" />}
      </div>
    </div>
  );
}
