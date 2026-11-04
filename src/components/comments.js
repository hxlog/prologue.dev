"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

// Giscus is a third-party iframe: a network round-trip to giscus.app plus its
// own script and CSS, mounted at the bottom of every article. It used to load
// with the page, so every reader paid for a comment widget most of them never
// scrolled to -- on the pages where LCP matters most. It is now mounted only
// when the reader is within 600px of it, which keeps third-party work off the
// initial load without changing what the reader sees on arrival at the end of
// the article.
//
// dynamic(..., { ssr: false }) is legal here because this file is a Client
// Component; @giscus/react stays out of the server bundle entirely.
const GiscusEmbed = dynamic(() => import("./giscus-embed"), { ssr: false });

export default function Comments() {
  const holderRef = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const element = holderRef.current;
    if (!element) return;

    // No IntersectionObserver (very old browsers, some test runners): mount
    // right away rather than never showing comments at all. Deferred by a tick
    // because a synchronous setState inside an effect is a cascading render
    // (react-hooks/set-state-in-effect) — there is nothing to observe here, so
    // the extra frame is free.
    if (typeof IntersectionObserver === "undefined") {
      const id = setTimeout(() => setReady(true), 0);
      return () => clearTimeout(id);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setReady(true);
          observer.disconnect();
        }
      },
      // Pre-load one viewport early so the widget is there before it is read,
      // not after.
      { rootMargin: "600px 0px" }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // The min-height reserves most of the iframe's height so the lazy mount does
  // not shove the footer down while the reader is looking at it.
  return (
    <div id="comments" ref={holderRef} className="min-h-[320px]">
      {ready ? <GiscusEmbed /> : null}
    </div>
  );
}
