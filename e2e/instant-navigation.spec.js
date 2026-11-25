import { test, expect } from "@playwright/test";
import { instant } from "@next/playwright";

const ORIGIN = "http://127.0.0.1:3108";

test.describe("instant client navigation", () => {
  test("home to /blog keeps the archive shell immediately", async ({ page }) => {
    await page.goto("/");
    await instant(page, async () => {
      await page.locator('nav a[href="/blog"]').first().click();
      await page.waitForURL((url) => url.pathname === "/blog");
      await expect(page.locator("main h1:visible")).toContainText("归档");
    });
  });

  test("home to /microblog keeps the microblog shell immediately", async ({ page }) => {
    await page.goto("/");
    await instant(page, async () => {
      await page.locator('nav a[href="/microblog"]').first().click();
      await page.waitForURL((url) => url.pathname === "/microblog");
      await expect(page.locator("main h1:visible")).toContainText("微博");
    });
  });

  test("home to /about prefetches the params page content", async ({ page }) => {
    await page.goto("/");
    await instant(page, async () => {
      await page.locator('nav a[href="/about"]').first().click();
      await page.waitForURL((url) => url.pathname === "/about");
      await expect(page.locator("main h1:visible")).toContainText("关于作者");
    });
  });


  // Regression: full prefetch on the /about nav link left the router with an
  // incomplete cache entry (tree + HTML only, no page payload) when the click
  // came from any route except "/", so the click silently did nothing. The nav
  // now uses the default prefetch strategy like every other link.
  test("post page can navigate to /about through the navbar", async ({ page }) => {
    await page.goto("/blog/2025-q1-economic-talk");
    await page.locator('header a[href="/about"]').first().click();
    await page.waitForURL((url) => url.pathname === "/about");
    await expect(page.locator("main h1:visible")).toContainText("关于作者");
  });


  // Regression: prefetch={true} on cards left an unusable router-cache entry
  // once the full prefetch settled, so a card clicked after hover did nothing.
  // Cards now use the default prefetch strategy; this waits for it to settle.
  test("home card still navigates after its prefetch has settled", async ({ page }) => {
    await page.goto("/");
    const card = page.locator('main a[href^="/blog/"]').nth(1);
    await card.hover();
    await page.waitForTimeout(1500);
    await card.click();
    await page.waitForURL((url) => url.pathname.startsWith("/blog/"));
    await expect(page.locator("article h1:visible")).toBeVisible();
  });

  test("archive card opens the post with its title available immediately", async ({ page }) => {
    await page.goto("/blog");
    await instant(page, async () => {
      await page.locator('article h3 a[href^="/blog/"]').first().click();
      await page.waitForURL((url) => url.pathname.startsWith("/blog/"));
      await expect(page.locator("article h1:visible")).toBeVisible();
    });
  });

  test("direct post visit exposes the app shell before the article streams", async ({ page }) => {
    await instant(
      page,
      async () => {
        await page.goto("/blog/2025-q1-economic-talk");
        await expect(page.locator(".glass-header")).toBeVisible();
      },
      { baseURL: ORIGIN }
    );
    await expect(page.locator("article h1:visible")).toContainText("2025 Q1经济杂谈");
  });

  test("direct tag visit exposes the archive shell before posts stream", async ({ page }) => {
    await instant(
      page,
      async () => {
        await page.goto("/tags/Economics");
        await expect(page.locator(".glass-header")).toBeVisible();
      },
      { baseURL: ORIGIN }
    );
    await expect(page.locator("main h1:visible")).toContainText("标签");
  });

  test("full static pages render their heading immediately", async ({ page }) => {
    for (const [path, heading] of [
      ["/blog", "归档"],
      ["/microblog", "微博"],
      ["/links", "友情链接"],
      ["/ui", "设计系统与 UI 标准"],
    ]) {
      await instant(
        page,
        async () => {
          await page.goto(path);
          await expect(page.locator("main h1:visible")).toContainText(heading);
        },
        { baseURL: ORIGIN }
      );
    }
  });
});