import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";

test("PP-059 T-U-01 nonce novo por request e headers internos consistentes", async () => {
  const { middleware } = await import("../middleware");
  const responses = [1, 2].map(() => middleware(new NextRequest("https://example.test/", {
    headers: { "x-nonce": "attacker-controlled" },
  })));
  const nonces = responses.map((response) => {
    const policy = response.headers.get("Content-Security-Policy") ?? "";
    const nonce = policy.match(/'nonce-([^']+)'/)?.[1];
    assert.ok(nonce);
    assert.notEqual(nonce, "attacker-controlled");
    assert.equal(response.headers.get("x-middleware-request-x-nonce"), nonce);
    assert.equal(response.headers.get("x-middleware-request-content-security-policy"), policy);
    assert.equal(response.headers.get("x-nonce"), null);
    return nonce;
  });
  assert.notEqual(nonces[0], nonces[1]);
});

test("PP-059 T-U-03 matcher exclui pix-qrcode e assets, inclui paginas", async () => {
  const { config } = await import("../middleware");
  const matches = (url: string) => unstable_doesMiddlewareMatch({ config, nextConfig: {}, url });
  assert.equal(matches("/api/pix-qrcode"), false);
  assert.equal(matches("/api/pix-qrcode?text=teste"), false);
  assert.equal(matches("/_next/static/chunk.js"), false);
  assert.equal(matches("/_next/image?url=test"), false);
  assert.equal(matches("/favicon.ico"), false);
  assert.equal(matches("/"), true);
  assert.equal(matches("/events/5826"), true);
  assert.equal(matches("/admin"), true);
});

test("PP-059 T-U-02 script-src permite apenas self e nonce", async () => {
  const { middleware } = await import("../middleware");
  const response = middleware(new NextRequest("https://example.test/"));
  const policy = response.headers.get("Content-Security-Policy") ?? "";
  const directive = policy.split("; ").find((value) => value.startsWith("script-src "));
  assert.match(directive ?? "", /^script-src 'self' 'nonce-[A-Za-z0-9+/=]+'$/);
  assert.ok(!directive?.includes("'unsafe-inline'"));
  assert.ok(policy.includes("style-src 'self' 'unsafe-inline'"));
});
