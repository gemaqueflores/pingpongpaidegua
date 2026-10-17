import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

// Independent decoder for the version-1 numeric QR fixture below. Reads modules
// from the returned SVG, unmasks data and decodes numeric segments (no encoder reuse).
function decodeNumericQr(svg: string): string {
  expect(svg).toMatch(/viewBox="0 0 23 23"/);
  const modules = Array.from({ length: 21 }, () => Array<number>(21).fill(0));
  const stroke = svg.match(/stroke="#000000" d="([^"]+)"/)?.[1] ?? "";
  let x = 0;
  let y = 0;
  for (const command of stroke.matchAll(/([Mm h])(-?[\d.]+)(?:[ ,](-?[\d.]+))?/g)) {
    if (command[1] === "M") { x = Number(command[2]); y = Number(command[3]); }
    if (command[1] === "m") { x += Number(command[2]); y += Number(command[3]); }
    if (command[1] === "h") {
      const length = Number(command[2]);
      for (let i = 0; i < length; i++) modules[Math.floor(y) - 1][x + i - 1] = 1;
      x += length;
    }
  }
  let format = 0;
  for (let i = 0; i < 15; i++) {
    const [fx, fy] = i < 6 ? [8, i] : i < 8 ? [8, i + 1] : i === 8 ? [7, 8] : [14 - i, 8];
    format |= modules[fy][fx] << i;
  }
  const mask = ((format ^ 0x5412) >> 10) & 7;
  const masks = [
    (r: number, c: number) => (r + c) % 2 === 0,
    (r: number) => r % 2 === 0,
    (_r: number, c: number) => c % 3 === 0,
    (r: number, c: number) => (r + c) % 3 === 0,
    (r: number, c: number) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r: number, c: number) => (r * c) % 2 + (r * c) % 3 === 0,
    (r: number, c: number) => ((r * c) % 2 + (r * c) % 3) % 2 === 0,
    (r: number, c: number) => ((r + c) % 2 + (r * c) % 3) % 2 === 0,
  ];
  const bits: number[] = [];
  let upwards = true;
  for (let right = 20; right > 0; right -= 2) {
    if (right === 6) right--;
    for (let row = 0; row < 21; row++) {
      const r = upwards ? 20 - row : row;
      for (const c of [right, right - 1]) {
        if (r === 6 || c === 6 || (r <= 8 && (c <= 8 || c >= 13)) || (r >= 13 && c <= 8)) continue;
        bits.push(modules[r][c] ^ Number(masks[mask](r, c)));
      }
    }
    upwards = !upwards;
  }
  let offset = 0;
  const read = (size: number) => bits.slice(offset, offset += size).reduce((n, bit) => n * 2 + bit, 0);
  expect(read(4)).toBe(1); // Numeric mode.
  let count = read(10);
  let result = "";
  while (count > 0) {
    const digits = Math.min(count, 3);
    result += String(read(digits === 3 ? 10 : digits === 2 ? 7 : 4)).padStart(digits, "0");
    count -= digits;
  }
  return result;
}

test("PP-059 T-E-01 home renderiza e hidrata com nonce por request", async ({ page }) => {
  const violations: string[] = [];
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (/content security policy|violates.*script-src/i.test(message.text())) {
      violations.push(message.text());
    }
  });
  // Keep the smoke independent of API availability and production data.
  const apiOrigin = new URL(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").origin;
  await page.route(`${apiOrigin}/**`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body:
      new URL(route.request().url()).pathname === "/efficiency" ? '{"ranking":[]}' : "[]" }));
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
  await expect(page.locator(".compact-summary-total").last()).toHaveText("0");
  expect(pageErrors).toEqual([]);
  // Vercel injects its optional Preview toolbar outside the app's trusted sources.
  expect(violations.filter((message) => !message.includes("https://vercel.live/"))).toEqual([]);
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

test("PP-SEC-013 T-E-03 QRCode decodifica payload e trata entradas invalidas", async ({ request }) => {
  const payload = "12345678";
  const valid = await request.get("/api/pix-qrcode", { params: { data: payload } });
  expect(valid.status()).toBe(200);
  expect(valid.headers()["content-type"]).toBe("image/svg+xml; charset=utf-8");
  expect(valid.headers()["content-security-policy"]).toBeUndefined();
  expect(decodeNumericQr(await valid.text())).toBe(payload);
  for (const data of [undefined, "   "]) {
    const invalid = await request.get("/api/pix-qrcode", { params: data === undefined ? {} : { data } });
    expect(invalid.status()).toBe(400);
    expect(await invalid.text()).toBe("Parametro 'data' ausente.");
  }
  const oversized = await request.get("/api/pix-qrcode", { params: { data: "x".repeat(3000) } });
  expect(oversized.status()).toBe(500);
  expect(await oversized.text()).toBe("Falha ao gerar QRCode.");
});

test("PP-SEC-013 T-E-04 login hidrata e preserva nonce dos scripts", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const response = await page.goto("/admin/login");
  expect(response?.status()).toBe(200);
  const nonce = response?.headers()["content-security-policy"]?.match(/'nonce-([^']+)'/)?.[1];
  expect(nonce).toBeTruthy();
  await expect(page.getByRole("heading", { name: "Login Admin" })).toBeVisible();
  const nonces = await page.locator("script:not([src])").evaluateAll((scripts) =>
    scripts.map((script) => (script as HTMLScriptElement).nonce));
  expect(nonces.length).toBeGreaterThan(0);
  expect(nonces.every((value) => value === nonce)).toBe(true);
  // State transition proves React event handlers hydrated; no real account needed.
  await page.getByRole("button", { name: "Esqueci a senha" }).click();
  await expect(page.getByRole("button", { name: "Enviar link de reset" })).toBeVisible();
  await page.getByRole("button", { name: "Esqueci a senha" }).click();
  await expect(page.getByRole("button", { name: "Enviar link de reset" })).toHaveCount(0);
  expect(errors).toEqual([]);
});
