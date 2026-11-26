import { test, expect } from "@playwright/test";

// Tag pages now share a persistent layout: a tag -> tag navigation replaces
// only the header text and the card column. These tests pin that contract down
// in a real browser: the sidebar/navbar/footer must not be remounted, the
// delayed in-flow skeletons must not cover the sidebar, and the static HTML
// must still contain the whole page without JavaScript.
const SOURCE_TAG = "/tags/Economics";
const TARGET_TAG = "/tags/Inequality";
const TARGET_LABEL = "不平等";

/**
 * Wait until React has hydrated the tag shell. Clicks on pre-hydration markup
 * are lost, which would make the delayed-RSC test flaky on a slow machine.
 * React attaches "__reactFiber$…" / "__reactProps$…" properties to the host
 * nodes it owns during hydration, and TagContent/TagHeader are client
 * components, so the existence of those properties proves the click handler
 * is live.
 */
async function waitForHydration(page) {
  await page.waitForFunction(
    () => {
      const node =
        document.querySelector("[data-tag-content]") ??
        document.querySelector("[data-tag-header]");
      return Boolean(
        node && Object.keys(node).some((key) => key.startsWith("__react")),
      );
    },
    { timeout: 15_000 },
  );
}

function watchDocumentRequests(page) {
  const requests = [];
  page.on("request", (request) => {
    if (request.resourceType() === "document") requests.push(request.url());
  });
  return requests;
}

function rects(page, selectors) {
  return page.evaluate((list) => {
    const out = {};
    for (const [key, selector] of Object.entries(list)) {
      const node = document.querySelector(selector);
      if (!node) {
        out[key] = null;
        continue;
      }
      const box = node.getBoundingClientRect();
      out[key] = {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        right: box.right,
        bottom: box.bottom,
      };
    }
    return out;
  }, selectors);
}

test.describe("tag partial refresh", () => {
  test("switching tags updates only the title and cards", async ({ page }) => {
    await page.goto(SOURCE_TAG);
    await expect(page.locator("main h1")).toContainText("经济学");
    await waitForHydration(page);
    await expect(
      page.locator(`[data-tag-sidebar] a[href="${TARGET_TAG}"]`),
    ).toBeVisible();

    // Marker attributes only survive if React does not remount the persistent
    // shell nodes while the page segment swaps.
    await page.evaluate(() => {
      document
        .querySelector("[data-tag-sidebar]")
        .setAttribute("data-tag-sidebar-marker", "1");
      document
        .querySelector("[data-tag-header]")
        .setAttribute("data-tag-header-marker", "1");
    });

    const documentRequests = watchDocumentRequests(page);

    // Hold the destination RSC payload back for 1.2 s so the ~140 ms delayed
    // skeleton has time to appear. Sidebar links are prefetch={false}, so this
    // is the click's own navigation request, not a prefetched response.
    await page.route("**/tags/Inequality*", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await route.continue();
    });

    const clickedAt = Date.now();
    await page.locator(`[data-tag-sidebar] a[href="${TARGET_TAG}"]`).click();

    // ~140 ms after the click, only the title and the card column show a
    // skeleton. Timing is asserted as a lower bound: an instant (prefetched)
    // swap must never flash it.
    const contentSkeleton = page.locator("[data-tag-content-skeleton]");
    const headerSkeleton = page.locator("[data-tag-header-skeleton]");
    await expect(contentSkeleton).toHaveCount(1, { timeout: 3000 });
    const shownAfter = Date.now() - clickedAt;
    expect(shownAfter).toBeGreaterThanOrEqual(100);
    await expect(headerSkeleton).toBeVisible();

    // The global fixed overlay must stay out of the tag-to-tag swap.
    await expect(page.locator("[data-nav-skeleton]")).toHaveCount(0);

    // Geometry: the card skeleton lives inside the content column (never over
    // the sidebar), and the title skeleton stays inside the header.
    const geometry = await rects(page, {
      sidebar: "[data-tag-sidebar]",
      contentSkeleton: "[data-tag-content-skeleton]",
      headerSkeleton: "[data-tag-header-skeleton]",
    });
    expect(geometry.contentSkeleton).not.toBeNull();
    expect(geometry.contentSkeleton.width).toBeGreaterThan(0);
    expect(geometry.contentSkeleton.x).toBeGreaterThanOrEqual(
      geometry.sidebar.right - 1,
    );
    expect(geometry.headerSkeleton.bottom).toBeLessThanOrEqual(
      geometry.contentSkeleton.y + 1,
    );

    // elementFromPoint at a sidebar link must still hit the sidebar, i.e. no
    // skeleton layer is sitting on top of the persistent navigation.
    const sidebarHitsSidebar = await page.evaluate(() => {
      const sidebar = document.querySelector("[data-tag-sidebar]");
      const link = sidebar.querySelector("a");
      const box = link.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + 10, box.y + box.height / 2);
      return Boolean(hit && sidebar.contains(hit));
    });
    expect(sidebarHitsSidebar).toBe(true);

    // The title skeleton covers the live (old) title while pending. (A
    // geometric check rather than elementFromPoint: the skeleton is
    // pointer-events:none so a click can still reach the page underneath, and
    // elementFromPoint deliberately skips such elements.)
    const titleCovered = await page.evaluate(() => {
      const skeleton = document.querySelector("[data-tag-header-skeleton]");
      const h1 = document.querySelector("[data-tag-header] h1");
      if (!skeleton || !h1) return false;
      const cover = skeleton.getBoundingClientRect();
      const title = h1.getBoundingClientRect();
      return (
        cover.left <= title.left &&
        cover.top <= title.top &&
        cover.right >= title.right &&
        cover.bottom >= title.bottom
      );
    });
    expect(titleCovered).toBe(true);

    // After the delayed RSC payload arrives, URL, header and cards update and
    // the skeletons are gone.
    await page.waitForURL((url) => url.pathname === TARGET_TAG);
    await expect(page.locator("main h1")).toContainText(TARGET_LABEL);
    await expect(
      page.locator(`[data-tag-sidebar] a[href="${TARGET_TAG}"]`),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.locator("main article")).toHaveCount(8);
    await expect(contentSkeleton).toHaveCount(0);
    await expect(headerSkeleton).toHaveCount(0);

    // Persistent shell: the same DOM nodes (and our markers) survived.
    await expect(
      page.locator(`[data-tag-sidebar][data-tag-sidebar-marker="1"]`),
    ).toHaveCount(1);
    await expect(
      page.locator(`[data-tag-header][data-tag-header-marker="1"]`),
    ).toHaveCount(1);

    // Client navigation only: no document request, no reload.
    expect(documentRequests).toEqual([]);
  });

  test("load more only appends cards", async ({ page }) => {
    await page.goto(SOURCE_TAG);
    await expect(page.locator("main article")).toHaveCount(8);
    await expect(page.locator("main h1")).toContainText("经济学");
    await waitForHydration(page);

    await page.evaluate(() => {
      document
        .querySelector("[data-tag-sidebar]")
        .setAttribute("data-tag-sidebar-marker", "1");
      document
        .querySelector("[data-tag-header]")
        .setAttribute("data-tag-header-marker", "1");
    });

    const documentRequests = watchDocumentRequests(page);

    await page.getByRole("button", { name: "加载更多" }).click();
    await expect(page.locator("main article")).toHaveCount(16);

    // The header, the sidebar and the URL are untouched by the local load-more.
    await expect(
      page.locator(`[data-tag-sidebar][data-tag-sidebar-marker="1"]`),
    ).toHaveCount(1);
    await expect(
      page.locator(`[data-tag-header][data-tag-header-marker="1"]`),
    ).toHaveCount(1);
    await expect(page.locator("main h1")).toContainText("经济学");
    expect(new URL(page.url()).pathname).toBe(SOURCE_TAG);
    expect(documentRequests).toEqual([]);
    await expect(page.locator("[data-nav-skeleton]")).toHaveCount(0);
  });
});

test.describe("tag page without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("serves the full title, sidebar and cards", async ({ page }) => {
    await page.goto(TARGET_TAG);

    // The h1 is rendered by a Client Component that reads usePathname(), but
    // the static export resolves that during the per-route build, so the HTML
    // already has the real tag name.
    await expect(page.locator("main h1")).toContainText(TARGET_LABEL);
    await expect(page.locator("main h1")).toContainText("标签");
    expect((await page.locator("main").innerText()).length).toBeGreaterThan(
      700,
    );

    // No skeleton marker ships in the HTML, and no pending state can exist
    // without JavaScript.
    await expect(page.locator("[data-tag-header-skeleton]")).toHaveCount(0);
    await expect(page.locator("[data-tag-content-skeleton]")).toHaveCount(0);
    const html = await page.content();
    expect(html).not.toContain("data-tag-header-skeleton");
    expect(html).not.toContain("data-tag-content-skeleton");

    // The persistent sidebar is part of the HTML and marks the active tag.
    await expect(page.locator("[data-tag-sidebar] a")).toHaveCount(15);
    await expect(
      page.locator(`[data-tag-sidebar] a[href="${TARGET_TAG}"]`),
    ).toHaveAttribute("aria-current", "page");

    // Full card content, not a loading state.
    await expect(page.locator("main article")).toHaveCount(8);
  });
});