import { test, expect } from "@playwright/test";

/**
 * Image priority for the above-the-fold assets of a post.
 *
 * 1. The cover is the LCP candidate: its <img> is loading="eager" and the same
 *    AVIF variant set is announced once from <head> as a preload link that has
 *    a real href. React 19's preload() omits href in imageSrcSet mode, which
 *    made the emitted link unusable; ResponsiveImage renders the link itself.
 * 2. The first body image is eager and every later one stays lazy, so a long
 *    article does not fetch all of its screenshots up front.
 *
 * The locators describe the markup semantically: the cover is the image inside
 * the article header, and body images are the article images outside it.
 */

const HERO_POST = "/blog/2026-how-do-i-use-deepseek-harness";
const BODY_IMAGE_POST = "/blog/first_job_first_exit_stop_the_bleeding";

test("article cover is eager and preloaded with a resolvable href", async ({
  page,
}) => {
  await page.goto(HERO_POST, { waitUntil: "load" });

  const hero = page.locator("main article header img").first();
  await expect(hero).toBeVisible();
  await expect(hero).toHaveAttribute("loading", "eager");
  await expect(hero).toHaveAttribute("fetchpriority", "high");

  // React 19 also auto-emits a preload hint for an eager <img> with srcSet;
  // that hint has no href by design. ResponsiveImage adds the resolvable one,
  // so assert on the link that actually carries href instead of on the total.
  const preload = page.locator('head link[rel="preload"][as="image"][href]');
  await expect(preload).toHaveCount(1);
  await expect(preload).toHaveAttribute("href", /^\/static\/\S+/);
  await expect(preload).toHaveAttribute(
    "imagesrcset",
    /\/static\/variants\/\S+ \d+w/,
  );
});

test("only the first body image is eager", async ({ page }) => {
  await page.goto(BODY_IMAGE_POST, { waitUntil: "load" });

  const bodyImages = page.locator(
    "xpath=//main//article//img[not(ancestor::header)]",
  );
  await expect(bodyImages.first()).toHaveAttribute("loading", "eager");

  const loading = await bodyImages.evaluateAll((images) =>
    images.map((image) => image.getAttribute("loading")),
  );
  expect(loading.length).toBeGreaterThan(1);
  expect(loading.slice(1).every((value) => value === "lazy")).toBe(true);
});