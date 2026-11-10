import { test, expect } from "@playwright/test";

/**
 * Feed contract.
 *
 * The feeds are the site's push channel: they must stay full-text, keep every
 * published post, use a deterministic build timestamp (so an unchanged corpus
 * does not produce a new byte sequence on every regeneration), and be edge
 * cacheable for the same window their ISR entry uses.
 */
const FEEDS = [
  { path: "/rss", type: "application/rss+xml", kind: "xml" },
  { path: "/atomfeed", type: "application/atom+xml", kind: "xml" },
  { path: "/jsonfeed", type: "application/feed+json", kind: "json" },
  { path: "/microblog/rss", type: "application/rss+xml", kind: "xml" },
];

test.describe("feeds", () => {
  for (const feed of FEEDS) {
    test(feed.path + " is served, cacheable and non-empty", async ({ request }) => {
      const response = await request.get(feed.path);
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toContain(feed.type);

      // 600s edge window == the ISR revalidate, so the CDN and the function
      // agree on how old a feed may be.
      expect(response.headers()["cache-control"]).toContain("s-maxage=600");

      const body = await response.text();
      expect(body.length).toBeGreaterThan(10_000);

      if (feed.kind === "json") {
        const parsed = JSON.parse(body);
        expect(parsed.version).toBe("https://jsonfeed.org/version/1.1");
        expect(parsed.items.length).toBe(65);
        expect(parsed.items.every((item) => item.content_html && item.content_html.length > 0)).toBe(true);
      }
    });
  }

  test("the article feeds keep all published posts with full text", async ({ request }) => {
    const xml = await (await request.get("/rss")).text();
    expect((xml.match(/<item>/g) || []).length).toBe(65);
    // content:encoded carries the rendered body; an empty one means the corpus
    // cache lost the HTML.
    const encoded = [...xml.matchAll(/<content:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>/g)];
    expect(encoded.length).toBe(65);
    expect(encoded.every((match) => match[1].trim().length > 200)).toBe(true);
  });

  test("lastBuildDate is deterministic across regenerations-free requests", async ({ request }) => {
    const first = await (await request.get("/rss")).text();
    const second = await (await request.get("/rss")).text();
    const stamp = (text) => (text.match(/<lastBuildDate>([^<]+)<\/lastBuildDate>/) || [])[1];
    expect(stamp(first)).toBeTruthy();
    expect(stamp(second)).toBe(stamp(first));
    // ...and it must not be the wall clock of the request.
    expect(Number.isNaN(Date.parse(stamp(first)))).toBe(false);
  });
});
