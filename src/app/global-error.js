"use client";

import { useEffect } from "react";

/** Root error boundary: same recovery contract as app/error.js. */
export default function GlobalError({ error, reset }) {
  useEffect(() => {
    const key = "prologue:global-error-reload";
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      /* ignore */
    }
    window.location.reload();
  }, []);

  return (
    <html lang="zh-CN">
      <body>
        <main style={{ maxWidth: 720, margin: "0 auto", padding: "96px 20px" }}>
          <h1 style={{ fontSize: 24, fontWeight: 600 }}>页面加载失败</h1>
          <p style={{ marginTop: 12 }}>已尝试自动重新加载，请刷新或清除站点缓存后重试。</p>
          <button onClick={() => reset()} style={{ marginTop: 24 }}>
            重试
          </button>
        </main>
      </body>
    </html>
  );
}
