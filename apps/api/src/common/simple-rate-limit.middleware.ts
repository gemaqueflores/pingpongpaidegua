import type { NextFunction, Request, Response } from "express";

type Bucket = {
  count: number;
  resetAt: number;
};

type RedisEvalReply = [number | string, number | string];
type RedisClient = {
  eval: (
    script: string,
    keyCount: number,
    ...args: Array<string | number>
  ) => Promise<RedisEvalReply>;
  quit?: () => Promise<void>;
  disconnect?: () => void;
  on?: (event: "error", listener: (error: unknown) => void) => void;
};

export class SimpleRateLimitMiddleware {
  private readonly buckets = new Map<string, Bucket>();
  private readonly windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS ?? "60000");
  private readonly defaultLimit = Number(process.env.RATE_LIMIT_DEFAULT_LIMIT ?? "180");
  private readonly heavyLimit = Number(process.env.RATE_LIMIT_HEAVY_LIMIT ?? "20");
  private readonly strictLimit = Number(process.env.RATE_LIMIT_STRICT_LIMIT ?? "30");
  private readonly useRedis = process.env.RATE_LIMIT_USE_REDIS !== "false";
  private readonly trustProxyHeaders = process.env.RATE_LIMIT_TRUST_PROXY === "true";
  private redis: RedisClient | null = null;
  private redisInitAttempted = false;

  private static readonly REDIS_INCR_SCRIPT = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("PTTL", KEYS[1])
return { current, ttl }
`;

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const now = Date.now();
    const ip = this.extractIp(req);
    const path = String(req.path ?? req.url ?? "/");
    const method = String(req.method ?? "GET").toUpperCase();
    const bucketKey = `${ip}:${method}:${this.classifyPath(path)}`;
    const limit = this.resolveLimit(method, path);
    const redisPrefix = process.env.RATE_LIMIT_REDIS_PREFIX?.trim() || "rl";
    const windowBucket = Math.floor(now / this.windowMs);
    const redisKey = `${redisPrefix}:${windowBucket}:${bucketKey}`;

    let count = 0;
    let resetAt = now + this.windowMs;

    try {
      const redisResult = await this.incrementRedisBucket(redisKey);
      if (redisResult) {
        count = redisResult.count;
        resetAt = redisResult.resetAt;
      } else {
        const localResult = this.incrementLocalBucket(bucketKey, now);
        count = localResult.count;
        resetAt = localResult.resetAt;
      }
    } catch {
      const localResult = this.incrementLocalBucket(bucketKey, now);
      count = localResult.count;
      resetAt = localResult.resetAt;
    }

    const remaining = Math.max(0, limit - count);
    res.setHeader("X-RateLimit-Limit", String(limit));
    res.setHeader("X-RateLimit-Remaining", String(remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(resetAt / 1000)));

    if (count > limit) {
      res.status(429).json({ message: "Muitas requisicoes. Tente novamente em instantes." });
      return;
    }

    this.gc(now);
    next();
  }

  async close(): Promise<void> {
    const redis = this.redis;
    this.redis = null;
    this.redisInitAttempted = false;
    if (!redis) {
      return;
    }
    try {
      if (typeof redis.quit === "function") {
        await redis.quit();
      } else if (typeof redis.disconnect === "function") {
        redis.disconnect();
      }
    } catch {
      // noop
    }
  }

  private resolveLimit(method: string, path: string): number {
    const classification = this.classifyPath(path);
    if (classification === "heavy") {
      return this.heavyLimit;
    }
    if (method === "POST" && /\/admin\/events\/\d+\/scrape-now$/i.test(path)) {
      return this.strictLimit;
    }
    if (method === "POST" && /\/admin\/events\/\d+\/reprocess-post-scrape$/i.test(path)) {
      return this.strictLimit;
    }
    if (method === "POST" && /\/auth\//i.test(path)) {
      return this.strictLimit;
    }
    if (method === "POST" && /\/support\/report-problem$/i.test(path)) {
      return this.strictLimit;
    }
    return this.defaultLimit;
  }

  private classifyPath(path: string): string {
    if (/\/admin\/events\/\d+\/scrape-now$/i.test(path)) {
      return "admin-scrape-now";
    }
    if (/\/admin\/events\/\d+\/reprocess-post-scrape$/i.test(path)) {
      return "admin-post-scrape";
    }
    if (/\/auth\//i.test(path)) {
      return "auth";
    }
    if (/\/support\/report-problem$/i.test(path)) {
      return "support-report-problem";
    }
    if (
      /\/events\/\d+\/(efficiency|medalists|group-simulation)$/i.test(path) ||
      /\/events\/\d+\/athletes\/\d+\/summary$/i.test(path) ||
      /\/athletes\/[^/]+\/career$/i.test(path) ||
      /\/clubs\/\d+\/efficiency-career$/i.test(path)
    ) {
      return "heavy";
    }
    return "general";
  }

  private extractIp(req: Request): string {
    if (this.trustProxyHeaders) {
      const forwarded = req.headers["x-forwarded-for"];
      if (typeof forwarded === "string" && forwarded.trim()) {
        return forwarded.split(",")[0].trim();
      }
      if (Array.isArray(forwarded) && forwarded.length > 0) {
        return String(forwarded[0]);
      }
    }
    if (Array.isArray(req.ips) && req.ips.length > 0) {
      return req.ips[0] ?? "unknown";
    }
    return req.ip || req.socket.remoteAddress || "unknown";
  }

  private gc(now: number): void {
    if (this.buckets.size < 500) {
      return;
    }
    for (const [key, bucket] of this.buckets.entries()) {
      if (now >= bucket.resetAt) {
        this.buckets.delete(key);
      }
    }
  }

  private incrementLocalBucket(
    key: string,
    now: number,
  ): { count: number; resetAt: number } {
    const current = this.buckets.get(key);
    const bucket =
      !current || now >= current.resetAt
        ? { count: 0, resetAt: now + this.windowMs }
        : current;
    bucket.count += 1;
    this.buckets.set(key, bucket);
    return { count: bucket.count, resetAt: bucket.resetAt };
  }

  private async incrementRedisBucket(
    key: string,
  ): Promise<{ count: number; resetAt: number } | null> {
    if (!this.useRedis) {
      return null;
    }
    const redis = await this.getRedisClient();
    if (!redis) {
      return null;
    }

    const reply = await redis.eval(
      SimpleRateLimitMiddleware.REDIS_INCR_SCRIPT,
      1,
      key,
      String(this.windowMs),
    );
    const count = Number(reply?.[0] ?? 0);
    const ttlMs = Math.max(0, Number(reply?.[1] ?? this.windowMs));
    if (!Number.isFinite(count) || count <= 0) {
      return null;
    }
    return {
      count,
      resetAt: Date.now() + ttlMs,
    };
  }

  private async getRedisClient(): Promise<RedisClient | null> {
    if (this.redis) {
      return this.redis;
    }
    if (this.redisInitAttempted) {
      return null;
    }
    this.redisInitAttempted = true;
    try {
      const moduleName = "ioredis";
      const ioredisModule = (await import(moduleName as string)) as {
        default: new (url: string, options?: Record<string, unknown>) => RedisClient;
      };
      const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
      const redis = new ioredisModule.default(redisUrl, {
        maxRetriesPerRequest: 1,
        enableReadyCheck: true,
        lazyConnect: false,
      });
      // A falha segue para o catch de use(), que aplica o bucket local. O listener
      // evita que o ioredis trate a rejeicao de autenticacao como evento sem handler.
      redis.on?.("error", () => undefined);
      this.redis = redis;
      return this.redis;
    } catch {
      this.redis = null;
      return null;
    }
  }
}
