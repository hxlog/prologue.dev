import { test, expect } from "@playwright/test";

const POST_PATH = "/blog/first_job_first_exit_stop_the_bleeding";

// Synthetic clicks must happen after React has hydrated the client components
// that install the click capture handlers; otherwise the test races hydration.
async function waitForHydration(page) {
  await page.waitForFunction(
    () => {
      const el = document.querySelector("header") || document.querySelector("main");
      return (
        el &&
        Object.keys(el).some(
          (key) =>
            key.startsWith("__reactFiber$") ||
            key.startsWith("__reactInternalInstance$"),
        )
      );
    },
    null,
    { timeout: 15000 },
  );
}

// The old navigation-watchdog forced a document navigation (a whole-tab reload)
// when it decided a client navigation had failed. Every request the browser
// makes to fetch a new HTML document is a reload; a client navigation only
// fetches the RSC payload. Record them so the assertions can prove no reload
// happened, including past the watchdog's 4 s (now removed) trigger.
function watchDocumentRequests(page) {
  const requests = [];
  page.on("request", (request) => {
    if (request.resourceType() === "document") requests.push(request.url());
  });
  return requests;
}

test.describe("client navigation stays client-side", () => {
  test("home card opens the post without a document navigation", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator('main a[href^="/blog/"]').first()).toBeVisible();
    const documentRequests = watchDocumentRequests(page);

    await page.locator('main a[href^="/blog/"]').first().click();
    await page.waitForURL((url) => url.pathname.startsWith("/blog/"));
    await expect(page.locator("article > header h1")).toBeVisible();
    expect((await page.locator("main").innerText()).length).toBeGreaterThan(
      1000,
    );

    // Hold past 6 s: the removed watchdog reloaded the tab after 4 s, and a
    // navigation error fallback would also surface here as a document request.
    await page.waitForTimeout(6000);
    expect(documentRequests).toEqual([]);
    expect(new URL(page.url()).pathname.startsWith("/blog/")).toBe(true);
    await expect(page.locator("article > header h1")).toBeVisible();
    await expect(page.locator("[data-nav-skeleton]")).toHaveCount(0);
  });
});

test.describe("navigation skeleton", () => {
  test("is absent from the server-rendered HTML and from a settled page", async ({
    page,
  }) => {
    await page.goto(POST_PATH);
    await expect(page.locator("article > header h1")).toBeVisible();
    await expect(page.locator("[data-nav-skeleton]")).toHaveCount(0);
    expect(await page.content()).not.toContain("data-nav-skeleton");
  });

  test("shows only after the delay and hides on popstate", async ({ page }) => {
    await page.goto("/");
    await waitForHydration(page);

    // A synthetic click on a same-origin anchor that changes the pathname is
    // exactly the signal the component listens for. preventDefault keeps the
    // browser on this page so the pending overlay can be observed on its own,
    // without racing a real route fetch.
    await page.evaluate(() => {
      const anchor = document.createElement("a");
      anchor.href = "/about";
      anchor.addEventListener("click", (event) => event.preventDefault());
      document.body.appendChild(anchor);
      anchor.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          button: 0,
          view: window,
        }),
      );
      anchor.remove();
    });

    // Nothing on the next frame: an instant navigation must not flash it.
    await expect(page.locator("[data-nav-skeleton]")).toHaveCount(0);

    const skeleton = page.locator("[data-nav-skeleton]");
    await expect(skeleton).toHaveCount(1, { timeout: 3000 });
    await expect(skeleton).toBeVisible();
    expect(
      await skeleton.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          pointerEvents: style.pointerEvents,
          position: style.position,
          ariaHidden: element.getAttribute("aria-hidden"),
        };
      }),
    ).toEqual({ pointerEvents: "none", position: "fixed", ariaHidden: "true" });

    // Back/forward: the URL moves before the router restores the tree, so the
    // pending overlay must disappear immediately.
    await page.evaluate(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await expect(page.locator("[data-nav-skeleton]")).toHaveCount(0);
  });
});

test.describe("static HTML (no JavaScript)", () => {
  test.use({ javaScriptEnabled: false });

  test("post page ships its full content, table wrappers and no skeleton", async ({
    page,
  }) => {
    await page.goto(POST_PATH);
    await expect(page.locator("main article > header h1")).toContainText("人生第一次辞职");
    expect((await page.locator("main").innerText()).length).toBeGreaterThan(
      1500,
    );
    await expect(page.locator("[data-nav-skeleton]")).toHaveCount(0);
    expect(await page.content()).not.toContain("data-nav-skeleton");

    // The table wrapper is emitted by the build-time rehype plugin, so the
    // no-JS export must already contain it.
    const tables = await page.locator("main table").evaluateAll((nodes) =>
      nodes.map((table) => {
        const wrapper = table.closest(".table-scroll");
        return {
          wrapped: Boolean(wrapper),
          role: wrapper?.getAttribute("role") ?? null,
          tabindex: wrapper?.getAttribute("tabindex") ?? null,
          label: wrapper?.getAttribute("aria-label") ?? null,
        };
      }),
    );
    expect(tables.length).toBeGreaterThan(0);
    for (const table of tables) {
      expect(table.wrapped).toBe(true);
      expect(table.role).toBe("region");
      expect(table.tabindex).toBe("0");
      expect(table.label).toBe("表格");
    }
  });

  test("home page ships its content without a skeleton", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("main h1").first()).toContainText(
      "What's past is prologue",
    );
    await expect(page.locator("[data-nav-skeleton]")).toHaveCount(0);
    expect((await page.locator("main").innerText()).length).toBeGreaterThan(
      1000,
    );
  });
});

test.describe("responsive layout", () => {
  test("no page-level horizontal scroll and tables scroll in their wrapper", async ({
    page,
  }) => {
    for (const width of [320, 375, 390]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(POST_PATH);
      await expect(page.locator("main article > header h1")).toBeVisible();

      const layout = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        tables: Array.from(document.querySelectorAll("main table")).map(
          (table) => {
            const wrapper = table.closest(".table-scroll");
            return {
              wrapped: Boolean(wrapper),
              overflowX: wrapper ? getComputedStyle(wrapper).overflowX : null,
            };
          },
        ),
      }));

      expect(layout.scrollWidth, `page scrollWidth at ${width}px`).toBe(
        layout.innerWidth,
      );
      expect(layout.tables.length).toBeGreaterThan(0);
      for (const table of layout.tables) {
        expect(table.wrapped, `table wrapper at ${width}px`).toBe(true);
        expect(table.overflowX, `table overflow at ${width}px`).toBe("auto");
      }
      if (width === 320) {
        // Prove the wrapper really is the scroller: shrink one table's region so
        // its content is guaranteed wider than the box, then scroll it. This
        // asserts the overflow container works without depending on how wide a
        // particular table happens to render at 320px.
        const canScroll = await page.evaluate(() => {
          const wrapper = document.querySelector("main .table-scroll");
          if (!wrapper) return false;
          const previousWidth = wrapper.style.width;
          wrapper.style.width = "120px";
          wrapper.scrollLeft = 60;
          const scrolled = wrapper.scrollLeft > 0;
          wrapper.scrollLeft = 0;
          wrapper.style.width = previousWidth;
          return scrolled;
        });
        expect(canScroll, "table wrapper is scrollable at 320px").toBe(true);
      }
    }
  });
});