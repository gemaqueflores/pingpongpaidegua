import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: ["log", "error", "warn", "debug"],
  });

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
  const allowedOrigins = [...new Set([...configuredOrigins, ...defaultLocalOrigins])];

  const originDelegate = (
    origin: string | undefined,
    callback: (error: Error | null, allow?: boolean) => void,
  ): void => {
    const requestOrigin = origin ?? undefined;
    if (!requestOrigin) {
      callback(null, true);
      return;
    }

    if (allowedOrigins.includes(requestOrigin)) {
      callback(null, true);
      return;
    }

    callback(new Error(`Origem nao permitida pelo CORS: ${requestOrigin}`), false);
  };

  app.enableCors({
    origin: originDelegate,
    credentials: true,
  });

  const port = Number(process.env.API_PORT ?? "4000");
  await app.listen(port);
}

bootstrap();
