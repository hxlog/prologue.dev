"use client";

import { useEffect, useId, useRef } from "react";
import { useTheme } from "next-themes";

/**
 * Client-side Mermaid renderer. Dynamically imports the official mermaid
 * package so pages without diagrams do not pay the bundle cost.
 */
export function MermaidBlock({ chart }) {
  const containerRef = useRef(null);
  const { resolvedTheme } = useTheme();
  const reactId = useId().replace(/:/g, "");

  useEffect(() => {
    if (!chart?.trim() || !containerRef.current) return;

    let cancelled = false;

    (async () => {
      const mermaid = (await import("mermaid")).default;
      const theme = resolvedTheme === "dark" ? "dark" : "default";
      const fontFamily =
        getComputedStyle(document.documentElement)
          .getPropertyValue("--font-sans")
          .trim() || "sans-serif";

      mermaid.initialize({
        startOnLoad: false,
        theme,
        // Mermaid 12 changed the flowchart default to `look: "neo"`, which
        // draws a drop-shadow halo and a gradient stroke around every node and
        // cluster. That is a second elevation under the site's flat hairline
        // surfaces, and next to GitHub's flat render it reads as duplicated
        // shadowing. The classic look is the flat one; globals.css carries the
        // same reset as an !important fallback so a mermaid upgrade cannot
        // silently bring the halo back.
        look: "classic",
        securityLevel: "loose",
        themeVariables: { fontFamily },
      });

      if (cancelled || !containerRef.current) return;

      const renderId = "mermaid-" + reactId + "-" + Date.now();
      try {
        const { svg } = await mermaid.render(renderId, chart.trim());
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
        }
      } catch (error) {
        console.error("Mermaid render failed:", error);
        if (!cancelled && containerRef.current) {
          containerRef.current.textContent = chart.trim();
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [chart, resolvedTheme, reactId]);

  return (
    <div
      ref={containerRef}
      className="mermaid my-6 overflow-x-auto not-prose"
      aria-label="Mermaid diagram"
    />
  );
}
