import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "ui.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: "list",
  outputDir: ".artifacts/test-results",
  use: {
    baseURL: "http://127.0.0.1:3011",
    browserName: "chromium",
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:3011",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
