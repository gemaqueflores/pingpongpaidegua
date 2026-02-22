import type { NextFunction, Request, Response } from "express";

type Bucket = {
  count: number;
  resetAt: number;
};

export class SimpleRateLimitMiddleware {
  private readonly buckets = new Map<string, Bucket>();
  private readonly windowMs = 60_000;
  private readonly defaultLimit = 180;
  private readonly strictLimit = 30;

  use(req: Request, res: Response, next: NextFunction): void {
    const now = Date.now();
    const ip = this.extractIp(req);
    const path = String(req.path ?? req.url ?? "/");
    const method = String(req.method ?? "GET").toUpperCase();
    const key = `${ip}:${method}:${this.classifyPath(path)}`;
    const limit = this.resolveLimit(method, path);

    const current = this.buckets.get(key);
    const bucket =
      !current || now >= current.resetAt
        ? { count: 0, resetAt: now + this.windowMs }
        : current;

    bucket.count += 1;
    this.buckets.set(key, bucket);

    const remaining = Math.max(0, limit - bucket.count);
    res.setHeader("X-RateLimit-Limit", String(limit));
    res.setHeader("X-RateLimit-Remaining", String(remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > limit) {
      res.status(429).json({ message: "Muitas requisicoes. Tente novamente em instantes." });
      return;
    }

    this.gc(now);
    next();
  }

  private resolveLimit(method: string, path: string): number {
    if (method === "POST" && /\/admin\/events\/\d+\/scrape-now$/i.test(path)) {
      return this.strictLimit;
    }
    if (method === "POST" && /\/auth\//i.test(path)) {
      return this.strictLimit;
    }
    return this.defaultLimit;
  }

  private classifyPath(path: string): string {
    if (/\/admin\/events\/\d+\/scrape-now$/i.test(path)) {
      return "admin-scrape-now";
    }
    if (/\/auth\//i.test(path)) {
      return "auth";
    }
    return "general";
  }

  private extractIp(req: Request): string {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.trim()) {
      return forwarded.split(",")[0].trim();
    }
    if (Array.isArray(forwarded) && forwarded.length > 0) {
      return String(forwarded[0]);
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
}

