import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "../../tmp/pp059-playwright",
  workers: 1,
  forbidOnly: !!process.env.CI,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100",
    browserName: "chromium",
    trace: "retain-on-failure",
    extraHTTPHeaders: process.env.E2E_VERCEL_PROTECTION_BYPASS
      ? { "x-vercel-protection-bypass": process.env.E2E_VERCEL_PROTECTION_BYPASS }
      : {},
  },
});
