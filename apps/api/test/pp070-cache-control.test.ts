import "reflect-metadata";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import test from "node:test";
import express from "express";
import { of, throwError } from "rxjs";
import { defaultNoStoreMiddleware } from "../src/common/default-no-store.middleware";
import { PUBLIC_CACHE_TTL_KEY } from "../src/common/public-cache.decorator";
import { PublicReadCacheInterceptor } from "../src/common/public-read-cache.interceptor";

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
  assert.ok(
    mainSource.indexOf("app.use(defaultNoStoreMiddleware)") < mainSource.indexOf("app.enableCors"),
    "no-store deve executar antes de respostas antecipadas do CORS",
  );
});

test("PP-070 T-I-04: rota publica bem-sucedida mantem cache publico", async () => {
  const app = express();
  const interceptor = new PublicReadCacheInterceptor();
  const publicHandler = () => undefined;
  Reflect.defineMetadata(PUBLIC_CACHE_TTL_KEY, 37, publicHandler);

  app.use(defaultNoStoreMiddleware);
  app.get("/public", (req, res, next) => {
    const context = {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
      }),
      getHandler: () => publicHandler,
      getClass: () => publicHandler,
    };

    interceptor.intercept(context as never, { handle: () => of({ public: true }) }).subscribe({
      next: (body) => res.json(body),
      error: next,
    });
  });

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolveListening, reject) => {
    server.once("listening", resolveListening);
    server.once("error", reject);
  });

  try {
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/public`);
    assert.equal(
      response.headers.get("Cache-Control"),
      "public, s-maxage=37, stale-while-revalidate=37",
    );
  } finally {
    await new Promise<void>((resolveClose, reject) => {
      server.close((error) => (error ? reject(error) : resolveClose()));
    });
  }
});

test("PP-070 T-I-05: erro em rota publica permanece no-store", async () => {
  const app = express();
  const interceptor = new PublicReadCacheInterceptor();
  const publicHandler = () => undefined;
  Reflect.defineMetadata(PUBLIC_CACHE_TTL_KEY, 37, publicHandler);

  app.use(defaultNoStoreMiddleware);
  app.get("/public-error", (req, res, next) => {
    const context = {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
      }),
      getHandler: () => publicHandler,
      getClass: () => publicHandler,
    };

    interceptor.intercept(
      context as never,
      { handle: () => throwError(() => new Error("falha controlada")) },
    ).subscribe({
      next: (body) => res.json(body),
      error: next,
    });
  });
  app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: true });
  });

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolveListening, reject) => {
    server.once("listening", resolveListening);
    server.once("error", reject);
  });

  try {
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/public-error`);
    assert.equal(response.status, 500);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  } finally {
    await new Promise<void>((resolveClose, reject) => {
      server.close((error) => (error ? reject(error) : resolveClose()));
    });
  }
});
