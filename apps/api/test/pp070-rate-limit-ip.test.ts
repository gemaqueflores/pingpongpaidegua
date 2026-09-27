import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { SimpleRateLimitMiddleware } from "../src/common/simple-rate-limit.middleware";

test("PP-070 T-I-01: XFF forjado nao troca o balde de rate limit", async () => {
  const previousEnv = snapshotEnv([
    "RATE_LIMIT_USE_REDIS",
    "RATE_LIMIT_TRUST_PROXY",
    "RATE_LIMIT_DEFAULT_LIMIT",
  ]);
  process.env.RATE_LIMIT_USE_REDIS = "false";
  process.env.RATE_LIMIT_TRUST_PROXY = "true";
  process.env.RATE_LIMIT_DEFAULT_LIMIT = "5";

  const middleware = new SimpleRateLimitMiddleware();
  const app = express();
  app.set("trust proxy", 1);
  app.use((req, res, next) => {
    void middleware.use(req, res, next).catch(next);
  });
  app.get("/probe", (_req, res) => res.json({ ok: true }));

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  try {
    const address = server.address() as AddressInfo;
    const first = await fetch(`http://127.0.0.1:${address.port}/probe`, {
      headers: { "X-Forwarded-For": "6.6.6.6, 203.0.113.9" },
    });
    const second = await fetch(`http://127.0.0.1:${address.port}/probe`, {
      headers: { "X-Forwarded-For": "7.7.7.7, 203.0.113.9" },
    });

    assert.equal(first.headers.get("X-RateLimit-Remaining"), "4");
    assert.equal(second.headers.get("X-RateLimit-Remaining"), "3");
  } finally {
    await middleware.close();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    restoreEnv(previousEnv);
  }
});

function snapshotEnv(keys: string[]): Map<string, string | undefined> {
  return new Map(keys.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot: Map<string, string | undefined>): void {
  for (const [key, value] of snapshot) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
