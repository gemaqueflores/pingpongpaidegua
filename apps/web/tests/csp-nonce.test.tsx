import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

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
