import { test, expect } from "@playwright/test";

test.describe("lazy navigation overlays", () => {
  test("search dialog opens, searches and closes", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /搜索全站/ }).click();
    const panel = page.locator(".search-dialog-panel");
    await expect(panel).toBeVisible();
    await panel.locator("#site-search").fill("经济");
    await expect(panel.getByRole("option").first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
  });

  test("search clears its query after Ctrl/Cmd+K close", async ({ page }) => {
    await page.goto("/");
    const trigger = page.getByRole("button", { name: /搜索全站/ });
    await trigger.click();
    const panel = page.locator(".search-dialog-panel");
    await panel.locator("#site-search").fill("经济");
    await page.keyboard.press("Control+K");
    await expect(panel).toBeHidden();
    await trigger.click();
    await expect(panel.locator("#site-search")).toHaveValue("");
  });

  test("RSS modal opens from the toolbar", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "RSS 订阅" }).click();
    await expect(page.getByText("订阅更新")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByText("订阅更新")).toBeHidden();
  });

  test("email modal opens from the footer", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Email" }).click();
    await expect(page.getByText("联系我")).toBeVisible();
  });

  test("mobile menu manages focus, arrows and Escape", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const trigger = page.getByRole("button", { name: "Navigation" });
    await trigger.click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(page.getByRole("menuitem").first()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("menuitem").nth(1)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("mobile menu traps Tab and navigates", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.getByRole("button", { name: "Navigation" }).click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(page.getByRole("menuitem").first()).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByRole("menuitem").last()).toBeFocused();
    await page.getByRole("menuitem", { name: "归档" }).click();
    await page.waitForURL((url) => url.pathname === "/blog");
    await expect(page.locator("main h1:visible")).toContainText("归档");
  });
});
