import { expect, test } from "@playwright/test";

test("PP-059 T-E-01 home renderiza e hidrata com nonce por request", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/content security policy|violates.*script-src/i.test(message.text())) {
      violations.push(message.text());
    }
  });
  // Keep the smoke independent of API availability and production data.
  const apiOrigin = new URL(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").origin;
  await page.route(`${apiOrigin}/**`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  const policy = response?.headers()["content-security-policy"] ?? "";
  const nonce = policy.match(/'nonce-([^']+)'/)?.[1];
  expect(nonce).toBeTruthy();
  await expect(page.locator("body")).toContainText("PingPong");
  const inlineNonces = await page.locator("script:not([src])").evaluateAll((scripts) =>
    scripts.map((script) => (script as HTMLScriptElement).nonce));
  expect(inlineNonces.length).toBeGreaterThan(0);
  expect(inlineNonces.every((value) => value === nonce)).toBe(true);
  await expect.poll(() => page.evaluate(() =>
    Array.isArray((window as unknown as { __next_f?: unknown }).__next_f),
  )).toBe(true);
  expect(violations).toEqual([]);
  const second = await page.request.get("/");
  expect(second.headers()["content-security-policy"]).not.toBe(policy);
  const api = await page.request.get("/api/pix-qrcode");
  expect(api.headers()["content-security-policy"]).toBeUndefined();
});
