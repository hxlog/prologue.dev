"use client";

import { useEffect } from "react";

const CHECK_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Reloads an open tab when a newer static build is deployed.
 *
 * Static pages can outlive a deployment; the old HTML may then ask for chunks
 * that the new version no longer serves (Cloudflare calls this version skew).
 * /version.json is regenerated on every build, so a changed value means the tab
 * must reload to stay on one build.
 *
 * Checks run on focus/visibility/pageshow (the moments a stale tab is likely to
 * be used again), on reconnect, and on a 5-minute interval while the page is
 * visible. Nothing is rendered: this component has no UI.
 */
export default function VersionGuard() {
  useEffect(() => {
    let current = null;
    let inFlight = false;
    let disposed = false;

    const check = async () => {
      if (disposed || inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      try {
        const response = await fetch("/version.json", { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json();
        if (typeof data?.version !== "string") return;
        if (current === null) {
          current = data.version;
          return;
        }
        if (data.version !== current) {
          window.location.reload();
        }
      } catch {
        /* offline or local dev without a version file: retry on next trigger */
      } finally {
        inFlight = false;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") check();
    };

    // Do not compete with the first paint / hydration for the initial check.
    const idle = window.requestIdleCallback
      ? window.requestIdleCallback(() => check(), { timeout: 4000 })
      : window.setTimeout(check, 2000);
    const interval = window.setInterval(check, CHECK_INTERVAL_MS);

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", check);
    window.addEventListener("pageshow", check);
    window.addEventListener("online", check);

    return () => {
      disposed = true;
      window.clearInterval(interval);
      if (window.cancelIdleCallback) window.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", check);
      window.removeEventListener("pageshow", check);
      window.removeEventListener("online", check);
    };
  }, []);

  return null;
}
