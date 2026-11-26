import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { buildServiceWorker } from "../scripts/build-service-worker.mjs";

// Service worker coverage has two halves:
//
//   1. The generator (scripts/build-service-worker.mjs) is pure Node and is
//      exercised against a temp fixture, so this runs on every e2e job.
//   2. Registration is intentionally disabled under WebDriver (the component
//      skips navigator.webdriver === true), because a cache-first worker would
//      make the other e2e specs observe stale or offline-ambiguous state. The
//      browser test therefore asserts the opt-out, not the happy path.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(REPO_ROOT, "out");

const SHARED_CSS = "/_next/static/chunks/fixture-shared.css";
const SHARED_JS = "/_next/static/chunks/fixture-shared.js";
const PAGE_ONLY_JS = "/_next/static/chunks/fixture-page-only.js";

function fixtureHtml({ styles = [], scripts = [] }) {
  const head = styles
    .map(
      (href) =>
        '<link rel="stylesheet" href="' + href + '" data-precedence="next"/>',
    )
    .join("");
  const body = scripts
    .map((src) => '<script src="' + src + '" async=""></script>')
    .join("");
  return (
    "<!doctype html><html><head>" +
    head +
    '</head><body><main>fixture</main>' +
    body +
    "</body></html>"
  );
}

async function writeFixture(root, { withVersion = true } = {}) {
  const chunks = path.join(root, "_next", "static", "chunks");
  await fs.mkdir(chunks, { recursive: true });
  await fs.mkdir(path.join(root, "blog"), { recursive: true });
  await fs.writeFile(path.join(chunks, "fixture-shared.css"), "/* shared css */");
  await fs.writeFile(path.join(chunks, "fixture-shared.js"), "/* shared js */");
  await fs.writeFile(path.join(chunks, "fixture-page-only.js"), "/* page only */");
  await fs.writeFile(
    path.join(root, "index.html"),
    fixtureHtml({ styles: [SHARED_CSS], scripts: [SHARED_JS, PAGE_ONLY_JS] }),
  );
  await fs.writeFile(
    path.join(root, "blog", "post.html"),
    fixtureHtml({ styles: [SHARED_CSS], scripts: [SHARED_JS] }),
  );
  if (withVersion) {
    await fs.writeFile(
      path.join(root, "version.json"),
      JSON.stringify({ version: "fixture-version-1" }),
    );
  }
}

async function createFixtureDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "prologue-sw-"));
}

test.describe("build-service-worker.mjs", () => {
  test("precaches only the CSS/JS every page shares", async () => {
    const root = await createFixtureDir();
    try {
      await writeFixture(root);
      const summary = await buildServiceWorker(root);

      expect(summary.version).toBe("fixture-version-1");
      expect(summary.precacheCount).toBe(2);
      expect(summary.warnings).toEqual([]);

      const manifest = JSON.parse(
        await fs.readFile(path.join(root, "sw-manifest.json"), "utf8"),
      );
      expect(manifest.version).toBe("fixture-version-1");
      // Intersection: the stylesheet and script both pages reference. The
      // page-only chunk must stay out of the install payload.
      expect(manifest.precache).toEqual([SHARED_CSS, SHARED_JS]);
      expect(Number.isNaN(Date.parse(manifest.generatedAt))).toBe(false);

      const sw = await fs.readFile(path.join(root, "sw.js"), "utf8");
      expect(sw).toContain('const CACHE_VERSION = "fixture-version-1";');
      expect(sw).toContain(SHARED_CSS);
      expect(sw).toContain(SHARED_JS);
      expect(sw).not.toContain("fixture-page-only");

      // The generated worker is static text, so the cache policy is asserted
      // on its source rather than by driving a browser cache.
      expect(sw).toContain('self.addEventListener("install"');
      expect(sw).toContain('self.addEventListener("activate"');
      expect(sw).toContain("skipWaiting");
      expect(sw).toContain("clients.claim");
      expect(sw).toContain('"/_next/static/"');
      expect(sw).toContain('"/version.json"');
      expect(sw).toContain("_rsc");
      expect(sw).toContain("__next");
      expect(sw).toContain(".txt");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test("falls back to a timestamp version without version.json", async () => {
    const root = await createFixtureDir();
    try {
      await writeFixture(root, { withVersion: false });
      const summary = await buildServiceWorker(root);
      expect(summary.version).toMatch(/^\d{13}$/);
      const manifest = JSON.parse(
        await fs.readFile(path.join(root, "sw-manifest.json"), "utf8"),
      );
      expect(manifest.version).toBe(summary.version);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test("is idempotent for identical build output", async () => {
    const root = await createFixtureDir();
    try {
      await writeFixture(root);
      await buildServiceWorker(root);
      const swBefore = await fs.readFile(path.join(root, "sw.js"), "utf8");
      const manifestBefore = await fs.readFile(
        path.join(root, "sw-manifest.json"),
        "utf8",
      );

      const summary = await buildServiceWorker(root);
      expect(summary.swChanged).toBe(false);
      expect(summary.manifestChanged).toBe(false);
      expect(await fs.readFile(path.join(root, "sw.js"), "utf8")).toBe(swBefore);
      expect(
        await fs.readFile(path.join(root, "sw-manifest.json"), "utf8"),
      ).toBe(manifestBefore);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

test.describe("static export artifacts", () => {
  test("out/sw.js matches out/sw-manifest.json", async () => {
    const swPath = path.join(OUT_DIR, "sw.js");
    const manifestPath = path.join(OUT_DIR, "sw-manifest.json");
    test.skip(
      !existsSync(swPath) || !existsSync(manifestPath),
      "No static export in this workspace: /sw.js is produced by yarn export, while the e2e webServer only runs yarn build:e2e.",
    );

    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    expect(typeof manifest.version).toBe("string");
    expect(manifest.precache.length).toBeGreaterThan(0);
    expect(manifest.precache.some((url) => url.endsWith(".css"))).toBe(true);
    expect(manifest.precache.some((url) => url.endsWith(".js"))).toBe(true);
    for (const url of manifest.precache) {
      expect(url.startsWith("/")).toBe(true);
      expect(url).not.toContain("..");
      // Every precache URL must exist in the export: a 404 here would make
      // the install loop skip the asset silently (one try/catch per entry).
      expect(existsSync(path.join(OUT_DIR, url.slice(1)))).toBe(true);
    }

    const sw = await fs.readFile(swPath, "utf8");
    expect(sw).toContain(
      "const CACHE_VERSION = " + JSON.stringify(manifest.version),
    );
    expect(sw).toContain('"/version.json"');
  });
});

test.describe("service worker registration", () => {
  test("is skipped under WebDriver", async ({ page }) => {
    // Capture the worker script request itself: register() would fetch /sw.js
    // even though the e2e server has no such file, so "no request" proves the
    // WebDriver opt-out ran rather than that registration merely failed.
    const workerRequests = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/sw.js") {
        workerRequests.push(request.url());
      }
    });

    await page.goto("/");
    await page.waitForFunction(() => document.readyState === "complete");
    // Registration happens in a post-hydration effect. Wait for one idle period
    // after load (bounded by the timeout) so a late register() cannot slip past
    // the negative assertion without adding a fixed sleep.
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          const finish = () => resolve();
          if (typeof requestIdleCallback === "function") {
            requestIdleCallback(finish, { timeout: 2000 });
          } else {
            setTimeout(finish, 500);
          }
        }),
    );

    const state = await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return { supported: false };
      const registrations = await navigator.serviceWorker.getRegistrations();
      return {
        supported: true,
        webdriver: navigator.webdriver === true,
        registrations: registrations.length,
      };
    });

    test.skip(!state.supported, "This browser does not expose Service Workers.");
    test.skip(
      !state.webdriver,
      "Only the WebDriver opt-out is asserted; a real browser registers /sw.js.",
    );

    expect(state.registrations).toBe(0);
    expect(workerRequests).toEqual([]);
  });
});
