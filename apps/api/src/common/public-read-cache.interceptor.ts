import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { tap } from "rxjs/operators";
import { PUBLIC_CACHE_TTL_KEY } from "./public-cache.decorator";
import {
  normalizeReadModelPublishMode,
  runWithReadModelPublishMode,
} from "../user/read-model-publish-context";

@Injectable()
export class PublicReadCacheInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{
      method?: string;
      headers?: Record<string, string | string[] | undefined>;
      query?: Record<string, unknown>;
    }>();
    const response = context.switchToHttp().getResponse<{ setHeader: (name: string, value: string) => void }>();

    const method = String(request?.method ?? "GET").toUpperCase();
    if (method !== "GET") {
      return next.handle();
    }

    const handler = context.getHandler();
    const cls = context.getClass();
    const ttlFromHandler = Reflect.getMetadata(PUBLIC_CACHE_TTL_KEY, handler) as number | undefined;
    const ttlFromClass = Reflect.getMetadata(PUBLIC_CACHE_TTL_KEY, cls) as number | undefined;
    const ttl = ttlFromHandler ?? ttlFromClass ?? 60;

    const publishMode = normalizeReadModelPublishMode(
      request?.headers?.["x-read-model-publish-mode"] ?? request?.query?.publishMode,
    );

    return runWithReadModelPublishMode(publishMode, () =>
      next.handle().pipe(
        tap(() => {
          response.setHeader(
            "Cache-Control",
            `public, s-maxage=${ttl}, stale-while-revalidate=${Math.max(0, ttl)}`,
          );
        }),
      ),
    );
  }
}
