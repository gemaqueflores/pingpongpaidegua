import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

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

test("PP-059 T-E-02 bloqueia inline sem nonce e permite nonce correto", async ({ page }) => {
  const fixture = readFileSync(path.join(__dirname, "fixtures/csp-inline.html"), "utf8");
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/violates.*script-src|executing inline script/i.test(message.text())) {
      violations.push(message.text());
    }
  });
  await page.route("**/__csp-fixture__", async (route) => {
    // Reuse the deployed middleware policy, without a production fixture route.
    const response = await route.fetch({ url: new URL("/", route.request().url()).href });
    const headers = response.headers();
    const nonce = headers["content-security-policy"].match(/'nonce-([^']+)'/)?.[1];
    expect(nonce).toBeTruthy();
    delete headers["content-length"];
    delete headers["content-encoding"];
    await route.fulfill({ status: 200, headers, contentType: "text/html", body: fixture.replaceAll("{{NONCE}}", nonce!) });
  });
  await page.goto("/__csp-fixture__");
  await expect(page.locator("#allowed")).toHaveText("nonce executado");
  await expect(page.locator("#blocked")).toHaveText("bloqueado");
  await expect(page.locator("#wrong-nonce")).toHaveText("bloqueado");
  await expect.poll(() => violations.length).toBeGreaterThanOrEqual(2);
});
