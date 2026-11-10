import { test, expect } from "@playwright/test";

/**
 * Media regression guard.
 *
 * Two failures this locks down:
 *   1. SVG in a post body used to 400 through /_next/image (the optimizer
 *      refuses SVG unless dangerouslyAllowSVG is on), so 12 diagrams were
 *      silently missing in production. The renderer now passes \`unoptimized\`
 *      for SVG and animated bitmaps.
 *   2. A renamed/removed asset (the image tree is content-hashed now) would show
 *      up as a broken image rather than a build error.
 *
 * It walks the posts that historically carried the SVG and the 4.7 MB animated
 * chart, plus a couple of ordinary ones.
 */
const POSTS = [
  "/blog/csi-300-valuation-study-ridge-regression-lasso-regression-and-cross-tests",
  "/blog/differentials-inplotly-data-visualization-social-finance-scale-cpi-ppi-m2-m1",
  "/blog/evaluating-ai-data-labeling-accuracy",
  "/blog/how-this-blog-is-built",
];

test("every body image decodes and no optimizer request fails", async ({ page }) => {
  const failed = [];
  page.on("response", (response) => {
    const url = response.url();
    if ((url.includes("/_next/image") || url.includes("/static/")) && response.status() >= 400) {
      failed.push(response.status() + " " + url);
    }
  });

  for (const path of POSTS) {
    await page.goto(path, { waitUntil: "load" });

    // Below-the-fold images are lazy; force them in and give the optimizer a
    // moment, then assert every one has real pixels.
    const broken = await page.evaluate(async () => {
      const images = [...document.querySelectorAll("main article img, main img.lightbox-image")];
      for (const image of images) {
        image.loading = "eager";
        image.setAttribute("fetchpriority", "low");
      }
      await new Promise((resolve) => setTimeout(resolve, 2500));
      return images
        .filter((image) => !image.naturalWidth)
        .map((image) => image.currentSrc || image.src || image.outerHTML.slice(0, 120));
    });

    expect(broken, path + " has images that never decoded: " + broken.join(" | ")).toEqual([]);
  }

  expect(failed, "asset or optimizer responses >= 400: " + failed.join(" | ")).toEqual([]);
});
