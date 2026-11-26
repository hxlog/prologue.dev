"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTheme } from "next-themes";

/**
 * Client-side Mermaid renderer.
 *
 * Mermaid (parser + layout engine + themes) is by far the heaviest client
 * dependency on a post page, and most diagrams sit far below the fold. The
 * placeholder is therefore observed with an IntersectionObserver and the
 * dynamic import + render only happen once the diagram is within 400px of the
 * viewport; a page whose diagrams are never reached never loads mermaid at all.
 * Browsers without IntersectionObserver fall back to rendering immediately.
 *
 * The observer is disconnected on the first intersection and in the effect
 * cleanup, so it cannot fire (or leak) after the block unmounts.
 */
const NEAR_VIEWPORT_MARGIN = "400px";

export function MermaidBlock({ chart }) {
  const containerRef = useRef(null);
  const { resolvedTheme } = useTheme();
  const reactId = useId().replace(/:/g, "");
  // Without IntersectionObserver there is nothing to wait for: render on mount.
  // The server pass always takes this branch, but its output is the same empty
  // placeholder either way, so hydration is unaffected.
  const [nearViewport, setNearViewport] = useState(
    () => typeof IntersectionObserver !== "function",
  );

  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof IntersectionObserver !== "function") return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setNearViewport(true);
        observer.disconnect();
      },
      { rootMargin: NEAR_VIEWPORT_MARGIN },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!nearViewport || !chart?.trim() || !containerRef.current) return;

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
  }, [chart, nearViewport, reactId, resolvedTheme]);

  // The :empty placeholder rule in globals.css gives this zero-height element a
  // single pixel so IntersectionObserver reliably reports it in every engine;
  // the rule stops applying as soon as the SVG or the fallback text is written.
  return (
    <div
      ref={containerRef}
      className="mermaid my-6 overflow-x-auto not-prose"
      aria-label="Mermaid diagram"
    />
  );
}
