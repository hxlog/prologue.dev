"use client";

import { useEffect } from "react";

/**
 * Navigation watchdog for the static export.
 *
 * A client-side navigation that fails (version-skewed RSC data, a blocked
 * subresource) can leave the shared layout painting while the page segment
 * stays blank. The error boundary catches render errors; this catches the
 * silent case: if an internal link click does not produce a readable <main>
 * within a few seconds, fall back to a normal document navigation, which always
 * fetches one consistent HTML/build.
 */
export default function NavigationWatchdog() {
  useEffect(() => {
    const onClick = (event) => {
      if (event.defaultPrevented && event.button !== 0) return;
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!anchor || anchor.target || anchor.hasAttribute("download")) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      let url;
      try {
        url = new URL(anchor.getAttribute("href"), window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.hash) return;

      window.setTimeout(() => {
        const main = document.querySelector("main");
        const readable = main && main.innerText.trim().length > 80;
        const stillOnOldPage = window.location.pathname + window.location.search === url.pathname + url.search;
        if (!readable || stillOnOldPage) {
          window.location.assign(url.href);
        }
      }, 4000);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  return null;
}
