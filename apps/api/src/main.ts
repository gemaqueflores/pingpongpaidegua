import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NextFunction, Request, Response } from "express";
import { AppModule } from "./app.module";
import { defaultNoStoreMiddleware } from "./common/default-no-store.middleware";
import { SimpleRateLimitMiddleware } from "./common/simple-rate-limit.middleware";
import { applyTrustProxy } from "./common/trust-proxy";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: ["log", "error", "warn", "debug"],
  });
  const httpApp = app.getHttpAdapter().getInstance();
  httpApp.disable("x-powered-by");
  applyTrustProxy(httpApp);

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  const configuredOrigins = (process.env.FRONTEND_URL ?? "http://localhost:3000")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const defaultLocalOrigins = ["http://localhost:3000", "http://127.0.0.1:3000"];
  const configuredOriginSet = new Set([...configuredOrigins, ...defaultLocalOrigins]);
  const allowVercelPreviews = process.env.FRONTEND_ALLOW_VERCEL_PREVIEWS !== "false";

  const wildcardMatchers = [...configuredOriginSet]
    .filter((origin) => origin.includes("*"))
    .map((pattern) => {
      const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
      return new RegExp(`^${escaped}$`, "i");
    });

  const exactOriginSet = new Set([...configuredOriginSet].filter((origin) => !origin.includes("*")));

  const isOriginAllowed = (origin: string): boolean => {
    if (exactOriginSet.has(origin)) {
      return true;
    }

    if (wildcardMatchers.some((matcher) => matcher.test(origin))) {
      return true;
    }

    if (allowVercelPreviews && /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)) {
      return true;
    }

    return false;
  };

  const originDelegate = (
    origin: string | undefined,
    callback: (error: Error | null, allow?: boolean) => void,
  ): void => {
    const requestOrigin = origin ?? undefined;
    if (!requestOrigin) {
      callback(null, true);
      return;
    }

    if (isOriginAllowed(requestOrigin)) {
      callback(null, true);
      return;
    }

    callback(new Error(`Origem nao permitida pelo CORS: ${requestOrigin}`), false);
  };

  app.use(defaultNoStoreMiddleware);
  app.enableCors({
    origin: originDelegate,
    credentials: true,
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader("X-DNS-Prefetch-Control", "off");
    if ((req.headers["x-forwarded-proto"] ?? req.protocol) === "https") {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    next();
  });

  const rateLimit = new SimpleRateLimitMiddleware();
  app.use((req: Request, res: Response, next: NextFunction) => {
    void rateLimit.use(req, res, next).catch(next);
  });

  const port = Number(process.env.API_PORT ?? "4000");
  await app.listen(port);

  const gracefulShutdown = async () => {
    await rateLimit.close();
    await app.close();
  };

  process.on("SIGINT", () => {
    void gracefulShutdown().finally(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    void gracefulShutdown().finally(() => process.exit(0));
  });
}

bootstrap();
