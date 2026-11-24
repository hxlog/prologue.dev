import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3108",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "yarn build:e2e && yarn start --port 3108",
    url: "http://127.0.0.1:3108",
    reuseExistingServer: !process.env.CI,
    // A clean CI runner regenerates every image variant (AVIF is slow) before
    // next build, so the webServer command legitimately needs more than the old
    // 4-minute cap; local runs hit the warm cache in seconds.
    timeout: 900_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
