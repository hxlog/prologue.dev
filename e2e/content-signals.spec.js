import { test, expect } from "@playwright/test";

// Content Signals: every robots.txt group must declare the AI usage
// preferences so crawlers matching a specific User-Agent block still see it.
test("robots.txt declares Content-Signal for every group", async ({ request }) => {
  const response = await request.get("/robots.txt");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/plain");
  const body = await response.text();

  expect(body).toContain(
    "Content-Signal: search=yes, ai-input=yes, ai-train=no",
  );
  expect(body).toContain("User-Agent: *");
  expect(body).toMatch(/User-Agent: \*\nContent-Signal: search=yes, ai-input=yes, ai-train=no\nAllow: \//);
  expect(body).toContain("User-Agent: GPTBot");
  expect(body).toContain("User-Agent: OAI-SearchBot");
  expect(body).toContain("Sitemap: https://prologue.dev/sitemap.xml");
  // One directive per User-Agent block (11 groups in this site).
  const groups = (body.match(/^User-Agent:/gm) || []).length;
  const signals = (body.match(/^Content-Signal:/gm) || []).length;
  expect(signals).toBe(groups);
});
