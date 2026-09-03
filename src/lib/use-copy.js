"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Clipboard copy with three states:
 * - "idle"    → nothing happened yet (or state expired)
 * - "copied"  → text is on the clipboard
 * - "error"   → Clipboard API unavailable/denied → UI should prompt the user
 *               to copy manually (the text stays visible & selectable).
 */
export function useCopy(resetMs = 2000) {
  const [state, setState] = useState("idle");
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(
    async (text) => {
      try {
        if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
        await navigator.clipboard.writeText(text);
        setState("copied");
      } catch {
        setState("error");
      }
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setState("idle"), resetMs);
    },
    [resetMs]
  );

  return { state, copy };
}
