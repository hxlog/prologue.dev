"use client";

import { useEffect } from "react";

/**
 * Session-replay recorder, loaded only after the reader interacts (or after a
 * long idle fallback). The main Umami script above already records pageviews and
 * web-vitals; this second 58 KB script is the one that shows up as long
 * main-thread work in Lighthouse when it loads on every visit, so a passive
 * reader who never touches the page never pays for it.
 */
export default function UmamiRecorderLazy({ src, websiteId }) {
  useEffect(() => {
    if (!src || !websiteId) return undefined;
    let loaded = false;
    const events = ["pointerdown", "keydown", "touchstart", "scroll"];

    const cleanup = () => {
      for (const event of events) window.removeEventListener(event, load);
    };
    const load = () => {
      if (loaded) return;
      loaded = true;
      cleanup();
      const script = document.createElement("script");
      script.src = src;
      script.defer = true;
      script.setAttribute("data-website-id", websiteId);
      document.body.appendChild(script);
    };

    for (const event of events) window.addEventListener(event, load, { passive: true });
    const timer = window.setTimeout(load, 20000);

    return () => {
      window.clearTimeout(timer);
      cleanup();
    };
  }, [src, websiteId]);

  return null;
}
