import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import test from "node:test";
import express from "express";
import { defaultNoStoreMiddleware } from "../src/common/default-no-store.middleware";

test("PP-070 T-I-03: rota nao publica responde no-store", async () => {
  const app = express();
  app.use(defaultNoStoreMiddleware);
  app.get("/private", (_req, res) => res.json({ private: true }));

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolveListening, reject) => {
    server.once("listening", resolveListening);
    server.once("error", reject);
  });

  try {
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/private`);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  } finally {
    await new Promise<void>((resolveClose, reject) => {
      server.close((error) => (error ? reject(error) : resolveClose()));
    });
  }

  const mainSource = readFileSync(resolve(__dirname, "../src/main.ts"), "utf8");
  assert.match(mainSource, /app\.use\(defaultNoStoreMiddleware\)/);
});
