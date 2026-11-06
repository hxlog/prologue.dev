import { test, expect } from "@playwright/test";

/**
 * Report-only lab measurement. The assertions guard against a completely
 * missing paint, not a performance budget: CI machine speed varies too much
 * for a byte- or millisecond threshold.
 */
test("collect initial-load metrics", async ({ page }) => {
  await page.addInitScript(() => {
    window.__lcp = 0;
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) window.__lcp = entry.startTime;
        }
      }).observe({ type: "largest-contentful-paint", buffered: true });
    } catch {
      // Browser without LCP support: the report simply omits it.
    }
  });

  for (const path of ["/", "/blog", "/blog/2025-q1-economic-talk", "/microblog"]) {
    await page.goto(path, { waitUntil: "load" });
    await page.waitForTimeout(1200);
    const metrics = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0];
      const resources = performance.getEntriesByType("resource");
      const fcp = performance.getEntriesByName("first-contentful-paint")[0];
      return {
        path: location.pathname,
        fcp: Math.round(fcp?.startTime || 0),
        lcp: Math.round(window.__lcp || 0),
        domContentLoaded: Math.round(nav?.domContentLoadedEventEnd || 0),
        loadEvent: Math.round(nav?.loadEventEnd || 0),
        resources: resources.length,
        transferBytes: resources.reduce(
          (sum, resource) => sum + (resource.transferSize || 0),
          0
        ),
      };
    });
    console.log("INITIAL_LOAD " + JSON.stringify(metrics));
    expect(metrics.fcp).toBeGreaterThan(0);
  }
});
