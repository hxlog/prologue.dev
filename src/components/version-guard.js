"use client";

import { useEffect } from "react";

/**
 * Reloads an open tab when a newer static build is deployed.
 *
 * Static pages can outlive a deployment; the old HTML may then ask for chunks
 * that the new version no longer serves. /version.json is regenerated on every
 * build, so a changed value means the tab must reload to stay on one build.
 */
export default function VersionGuard() {
  useEffect(() => {
    let current = null;

    const check = async () => {
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
        /* offline or local dev without a version file: retry on next focus */
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") check();
    };

    check();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", check);
    window.addEventListener("pageshow", check);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", check);
      window.removeEventListener("pageshow", check);
    };
  }, []);

  return null;
}
