import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NextFunction, Request, Response } from "express";
import { AppModule } from "./app.module";
import { defaultNoStoreMiddleware } from "./common/default-no-store.middleware";
import { isOriginAllowed } from "./common/cors-origin";
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
