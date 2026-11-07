import { test, expect } from "@playwright/test";

function jsonLdBlocks(html) {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(
    (match) => JSON.parse(match[1])
  );
}

function firstJsonLd(html, type) {
  return jsonLdBlocks(html).find((entry) => entry["@type"] === type);
}

test.describe("SEO output", () => {
  test("sitemap URLs are 200, canonical, indexable and have a page h1", async ({ request, baseURL }) => {
    const sitemap = await request.get("/sitemap.xml");
    expect(sitemap.status()).toBe(200);
    const xml = await sitemap.text();
    const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
    expect(urls.length).toBeGreaterThan(70);

    for (const url of urls) {
      const path = new URL(url).pathname || "/";
      const response = await request.get(path);
      expect(response.status(), path).toBe(200);
      const html = await response.text();
      expect(html, path).toContain('<link rel="canonical" href="' + url + '"');
      expect(html, path).not.toMatch(/<meta[^>]+name="robots"[^>]+content="[^"]*noindex/i);
      expect(html, path).toMatch(/<title[^>]*>[^<]+<\/title>/);
      expect((html.match(/<h1[^>]*>/g) || []).length, path).toBeGreaterThanOrEqual(1);
      expect(jsonLdBlocks(html).length, path).toBeGreaterThan(0);
    }
  });

  test("unknown, legacy and dotted dynamic paths are hard 404s", async ({ request }) => {
    for (const path of [
      "/blog/does-not-exist",
      "/tags/NotATag",
      "/blog/page/2",
      "/tags/Web3",
      "/missing-page",
      "/foo.txt",
      "/blog/foo.bar",
    ]) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(404);
    }
  });

  test("llms discovery files expose the intended public content", async ({ request }) => {
    const index = await request.get("/llms.txt");
    expect(index.status()).toBe(200);
    expect(index.headers()["content-type"]).toContain("text/plain");
    const indexText = await index.text();
    expect(indexText).toContain("## Posts");
    expect(indexText).toContain("/llms-full.txt");

    const full = await request.get("/llms-full.txt");
    expect(full.status()).toBe(200);
    expect(full.headers()["content-type"]).toContain("text/plain");
    const fullText = await full.text();
    expect(fullText).toContain("2025 Q1经济杂谈");
    expect(fullText).toContain("## Microblog");
  });

  test("person JSON-LD includes the configured Zhihu profile", async ({ request }) => {
    const html = await (await request.get("/")).text();
    const graph = jsonLdBlocks(html).find((entry) => entry["@graph"])?.["@graph"];
    const person = graph?.find((entry) => entry["@type"] === "Person");
    expect(person?.sameAs).toContain("https://www.zhihu.com/people/xingyu7");
  });

  test("collection pages expose ItemList JSON-LD", async ({ request }) => {
    for (const path of ["/blog", "/tags/Economics", "/microblog", "/links"]) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(200);
      const page = firstJsonLd(await response.text(), "CollectionPage");
      expect(page, path).toBeTruthy();
      expect(page.mainEntity?.["@type"], path).toBe("ItemList");
      expect(page.mainEntity?.numberOfItems, path).toBeGreaterThan(0);
    }
  });

  test("robots and feed discovery stay valid", async ({ request }) => {
    const robots = await request.get("/robots.txt");
    const robotsText = await robots.text();
    expect(robotsText).toContain("Sitemap: https://prologue.dev/sitemap.xml");
    expect(robotsText).not.toContain("Disallow: /og");
    expect(robotsText).toContain("User-Agent: GPTBot\nDisallow: /");
    expect(robotsText).toContain("User-Agent: ChatGPT-User\nAllow: /");

    for (const [path, type] of [
      ["/rss", "application/rss+xml"],
      ["/atomfeed", "application/atom+xml"],
      ["/jsonfeed", "application/feed+json"],
      ["/microblog/rss", "application/rss+xml"],
    ]) {
      const response = await request.get(path);
      expect(response.headers()["content-type"], path).toContain(type);
      expect(response.status(), path).toBe(200);
    }
  });


});
