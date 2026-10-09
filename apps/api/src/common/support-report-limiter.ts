import { HttpException, HttpStatus } from "@nestjs/common";

type LocalBucket = {
  count: number;
  expiresAt: number;
};

export type SupportReportRedisClient = {
  eval: (
    script: string,
    keyCount: number,
    ...args: Array<string | number>
  ) => Promise<Array<number | string>>;
  on?: (event: "error", listener: (error: unknown) => void) => void;
  quit?: () => Promise<void>;
  disconnect?: () => void;
};

type SupportReportLimiterOptions = {
  redis?: SupportReportRedisClient | null;
  now?: () => number;
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const GENERIC_LIMIT_MESSAGE = "Muitas solicitacoes. Tente novamente mais tarde.";

export class SupportReportLimiter {
  private readonly localBuckets = new Map<string, LocalBucket>();
  private readonly now: () => number;
  private redis: SupportReportRedisClient | null = null;
  private redisInitAttempted = false;
  private readonly injectedRedis: SupportReportRedisClient | null | undefined;

  private static readonly REDIS_INCR_SCRIPT = `
local hourly = redis.call("INCR", KEYS[1])
if hourly == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
local daily = tonumber(redis.call("GET", KEYS[2]) or "0")
if hourly <= 5 then
  daily = redis.call("INCR", KEYS[2])
  if daily == 1 then
    redis.call("PEXPIRE", KEYS[2], ARGV[2])
  end
end
return { hourly, daily }
`;

  constructor(options: SupportReportLimiterOptions = {}) {
    this.injectedRedis = options.redis;
    this.now = options.now ?? Date.now;
  }

  async assertAllowed(ipRaw: string): Promise<void> {
    const now = this.now();
    const ip = String(ipRaw || "unknown");
    const prefix = process.env.RATE_LIMIT_REDIS_PREFIX?.trim() || "rl";
    const hourlyKey = `${prefix}:support:hour:${Math.floor(now / HOUR_MS)}:${ip}`;
    const dailyKey = `${prefix}:support:day:${Math.floor(now / DAY_MS)}`;

    let counts: [number, number];
    try {
      const redis = await this.getRedisClient();
      if (!redis) {
        counts = this.incrementLocal(hourlyKey, dailyKey, now);
      } else {
        const reply = await redis.eval(
          SupportReportLimiter.REDIS_INCR_SCRIPT,
          2,
          hourlyKey,
          dailyKey,
          String(HOUR_MS),
          String(DAY_MS),
        );
        counts = [Number(reply[0]), Number(reply[1])];
        if (!counts.every((count) => Number.isFinite(count) && count > 0)) {
          counts = this.incrementLocal(hourlyKey, dailyKey, now);
        }
      }
    } catch {
      counts = this.incrementLocal(hourlyKey, dailyKey, now);
    }

    if (counts[0] > 5 || counts[1] > 50) {
      throw new HttpException(GENERIC_LIMIT_MESSAGE, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  async close(): Promise<void> {
    const redis = this.redis;
    this.redis = null;
    if (!redis || redis === this.injectedRedis) {
      return;
    }
    try {
      if (redis.quit) await redis.quit();
      else redis.disconnect?.();
    } catch {
      redis.disconnect?.();
    }
  }

  private incrementLocal(hourlyKey: string, dailyKey: string, now: number): [number, number] {
    const hourly = this.incrementLocalBucket(hourlyKey, HOUR_MS, now);
    const daily =
      hourly <= 5
        ? this.incrementLocalBucket(dailyKey, DAY_MS, now)
        : this.readLocalBucket(dailyKey, now);
    return [hourly, daily];
  }

  private readLocalBucket(key: string, now: number): number {
    const current = this.localBuckets.get(key);
    return current && current.expiresAt > now ? current.count : 0;
  }

  private incrementLocalBucket(key: string, ttlMs: number, now: number): number {
    const current = this.localBuckets.get(key);
    const bucket =
      !current || current.expiresAt <= now
        ? { count: 0, expiresAt: now + ttlMs }
        : current;
    bucket.count += 1;
    this.localBuckets.set(key, bucket);
    return bucket.count;
  }

  private async getRedisClient(): Promise<SupportReportRedisClient | null> {
    if (this.injectedRedis !== undefined) {
      return this.injectedRedis;
    }
    if (this.redis) {
      return this.redis;
    }
    if (this.redisInitAttempted || process.env.RATE_LIMIT_USE_REDIS === "false") {
      return null;
    }
    this.redisInitAttempted = true;
    try {
      const moduleName = "ioredis";
      const ioredisModule = (await import(moduleName as string)) as {
        default: new (
          url: string,
          options?: Record<string, unknown>,
        ) => SupportReportRedisClient;
      };
      const redis = new ioredisModule.default(process.env.REDIS_URL ?? "redis://localhost:6379", {
        maxRetriesPerRequest: 1,
        enableReadyCheck: true,
        lazyConnect: false,
      });
      redis.on?.("error", () => undefined);
      this.redis = redis;
      return redis;
    } catch {
      return null;
    }
  }
}
