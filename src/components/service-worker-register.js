"use client";

import { useEffect } from "react";

/**
 * Registers the build-generated service worker (/sw.js) after hydration.
 *
 * /sw.js and /sw-manifest.json are written by scripts/build-service-worker.mjs
 * as part of the static export; the worker precaches the CSS/JS shared by every
 * page and applies the runtime HTML/RSC cache policy. Registration is a
 * progressive enhancement, so it is skipped when:
 *
 *   - the bundle is not a production build — `next dev` serves no /sw.js and a
 *     worker left over from an export build would shadow hot-reloaded chunks;
 *   - NEXT_PUBLIC_DISABLE_SW=1 opts a build out (diagnosing cache issues, or a
 *     host that cannot serve /sw.js);
 *   - the browser has no Service Worker API;
 *   - navigator.webdriver is true (Playwright/WebDriver). e2e must observe the
 *     network rather than a worker cache, and a registration would outlive the
 *     run; see e2e/service-worker.spec.js.
 *
 * updateViaCache: "none" keeps the worker script itself out of the HTTP cache,
 * so a deploy that changes /sw.js is picked up on the next navigation instead
 * of after the script's HTTP max-age. Failures are silent: the site works
 * without a worker. Renders nothing.
 */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (process.env.NEXT_PUBLIC_DISABLE_SW === "1") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }
    // Playwright's Chromium reports navigator.webdriver === true. The worker
    // cache would make e2e assertions observe stale/offline-ambiguous state.
    if (navigator.webdriver === true) return;

    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch(() => {
        /* Optional enhancement: a host without /sw.js, or an offline load,
           must never surface an error or retry loop. */
      });
  }, []);

  return null;
}
