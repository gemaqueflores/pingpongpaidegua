import assert from "node:assert/strict";
import test, { after, mock } from "node:test";
import { HttpException } from "@nestjs/common";
import {
  SupportReportLimiter,
  type SupportReportRedisClient,
} from "../src/common/support-report-limiter";
import { UserService } from "../src/user/user.service";

let sendCount = 0;

const createTransport = () => ({
  async sendMail() {
    sendCount += 1;
    return {};
  },
});
const nodemailerMock = mock.module("nodemailer", {
  namedExports: { createTransport },
});

after(() => {
  nodemailerMock.restore();
});

class FakeRedis implements SupportReportRedisClient {
  private readonly values = new Map<string, { count: number; expiresAt: number }>();

  constructor(private readonly now: () => number) {}

  async eval(
    _script: string,
    keyCount: number,
    ...args: Array<string | number>
  ): Promise<Array<number | string>> {
    assert.equal(keyCount, 2);
    const keys = args.slice(0, keyCount).map(String);
    const ttlValues = args.slice(keyCount).map(Number);
    return keys.map((key, index) => {
      const current = this.values.get(key);
      const active = current && current.expiresAt > this.now() ? current : undefined;
      const next = {
        count: (active?.count ?? 0) + 1,
        expiresAt: active?.expiresAt ?? this.now() + ttlValues[index],
      };
      this.values.set(key, next);
      return next.count;
    });
  }
}

class FailingRedis implements SupportReportRedisClient {
  async eval(): Promise<Array<number | string>> {
    throw new Error("redis unavailable");
  }
}

function configureSmtp(): () => void {
  const keys = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"] as const;
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  process.env.SMTP_HOST = "smtp.example.test";
  process.env.SMTP_PORT = "587";
  process.env.SMTP_USER = "test-user";
  process.env.SMTP_PASS = "test-pass";
  process.env.SMTP_FROM = "noreply@example.test";
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

function serviceWith(limiter: SupportReportLimiter): UserService {
  return new UserService({} as never, {} as never, limiter);
}

function isTooManyRequests(error: unknown): boolean {
  return error instanceof HttpException && error.getStatus() === 429;
}

test("PP-071 T-U-01: sexta chamada do mesmo IP retorna 429 antes do SMTP", async () => {
  const restore = configureSmtp();
  sendCount = 0;
  const service = serviceWith(
    new SupportReportLimiter({ redis: new FakeRedis(() => Date.now()) }),
  );
  try {
    for (let index = 0; index < 5; index += 1) {
      await service.reportProblem("Falha", "Descricao", "203.0.113.10");
    }
    await assert.rejects(
      service.reportProblem("Falha", "Descricao", "203.0.113.10"),
      isTooManyRequests,
    );
    assert.equal(sendCount, 5);
  } finally {
    restore();
  }
});

test("PP-071 T-U-02: chamada 51 do dia retorna 429", async () => {
  const restore = configureSmtp();
  sendCount = 0;
  const service = serviceWith(
    new SupportReportLimiter({ redis: new FakeRedis(() => Date.now()) }),
  );
  try {
    for (let index = 0; index < 50; index += 1) {
      await service.reportProblem("Falha", "Descricao", `203.0.113.${index + 1}`);
    }
    await assert.rejects(
      service.reportProblem("Falha", "Descricao", "198.51.100.1"),
      isTooManyRequests,
    );
    assert.equal(sendCount, 50);
  } finally {
    restore();
  }
});

test("PP-071 T-U-03: janela expirada volta a aceitar", async () => {
  let now = Date.UTC(2026, 8, 27, 10, 0, 0);
  const limiter = new SupportReportLimiter({ redis: new FakeRedis(() => now), now: () => now });
  for (let index = 0; index < 5; index += 1) await limiter.assertAllowed("203.0.113.20");
  await assert.rejects(limiter.assertAllowed("203.0.113.20"), isTooManyRequests);

  now += 60 * 60 * 1000;
  await limiter.assertAllowed("203.0.113.20");
});

test("PP-071 T-U-04: duas instancias somam o limite no Redis compartilhado", async () => {
  const redis = new FakeRedis(() => Date.now());
  const first = new SupportReportLimiter({ redis });
  const second = new SupportReportLimiter({ redis });
  for (let index = 0; index < 3; index += 1) await first.assertAllowed("203.0.113.30");
  for (let index = 0; index < 2; index += 1) await second.assertAllowed("203.0.113.30");
  await assert.rejects(second.assertAllowed("203.0.113.30"), isTooManyRequests);
});

test("PP-071 T-U-05: Redis indisponivel usa fallback local sem 5xx", async () => {
  const limiter = new SupportReportLimiter({ redis: new FailingRedis() });
  for (let index = 0; index < 5; index += 1) await limiter.assertAllowed("203.0.113.40");
  await assert.rejects(limiter.assertAllowed("203.0.113.40"), isTooManyRequests);
});
