"use client";

import { useEffect } from "react";

/**
 * Page-segment error boundary.
 *
 * The site is a versioned static export: if a client still holds HTML/RSC data
 * from an older deployment (or a subresource request is blocked), the page
 * segment can fail to render while the shared layout (navbar/footer) keeps
 * painting -- the blank-content state readers reported. A hard reload is the
 * one recovery that cannot fail: it fetches the current HTML and its matching
 * chunks in one consistent build. Guard against a reload loop: if the error
 * survives the reload, show a readable message instead.
 */
export default function AppError({ error, reset }) {
  useEffect(() => {
    const key = "prologue:error-reload:" + window.location.pathname;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      /* storage unavailable: reload once unconditionally */
    }
    // Next chunk/version-skew errors are not recoverable in place.
    window.location.reload();
  }, []);

  return (
    <main className="mx-auto min-h-dvh w-full max-w-3xl px-5 py-24">
      <p className="eyebrow">加载失败</p>
      <h1 className="mt-4 text-title font-semibold text-foreground">
        页面内容未能加载
      </h1>
      <p className="mt-3 text-muted">
        已尝试自动重新加载。如果一直看到这个页面，请刷新一次或清除站点缓存。
      </p>
      <button className="btn btn-primary mt-6" onClick={() => reset()}>
        重试
      </button>
    </main>
  );
}
