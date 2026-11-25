import { test, expect } from "@playwright/test";

// The static export must put real content in the HTML: a reader with JS
// disabled (or a crawler that does not execute JS) must see the article, not a
// skeleton that only client hydration could replace.
test.use({ javaScriptEnabled: false });

test.describe("static HTML (no JavaScript)", () => {
  test("article page contains the full article", async ({ page }) => {
    await page.goto("/blog/2025-q1-economic-talk");
    await expect(page.locator("main h1")).toContainText("2025 Q1经济杂谈");
    expect((await page.locator("main").innerText()).length).toBeGreaterThan(
      1500,
    );
  });

  test("markdown page contains its body", async ({ page }) => {
    await page.goto("/about");
    await expect(page.locator("main h1")).toContainText("关于作者");
    await expect(page.locator("main")).toContainText("槐序");
  });

  test("tag and home pages contain their content", async ({ page }) => {
    await page.goto("/tags/Philosophy");
    await expect(page.locator("main h1")).toContainText("哲学");
    await page.goto("/");
    await expect(page.locator("main h1")).toContainText(
      "What's past is prologue",
    );
  });
});
