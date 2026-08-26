import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { Queue } from "bullmq";
import Redis from "ioredis";

type CommandResult = {
  status: number;
  stdout: string;
  stderr: string;
};

function docker(args: string[], env: NodeJS.ProcessEnv = process.env): CommandResult {
  // security-scan-ignore: executable is fixed, shell is disabled, and callers pass argument arrays.
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    env,
    shell: false,
  });
  if (result.error) {
    throw result.error;
  }
  return {
    status: result.status ?? 1,
    stdout: String(result.stdout ?? "").trim(),
    stderr: String(result.stderr ?? "").trim(),
  };
}

function requireSuccess(result: CommandResult, action: string): string {
  assert.equal(result.status, 0, `${action} falhou: ${result.stderr || result.stdout}`);
  return result.stdout;
}

async function waitForRedis(containerName: string, password: string): Promise<void> {
  const env = { ...process.env, REDISCLI_AUTH: password };
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = docker(
      ["exec", "-e", "REDISCLI_AUTH", containerName, "redis-cli", "ping"],
      env,
    );
    if (result.status === 0 && result.stdout === "PONG") {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Redis autenticado nao ficou pronto no tempo esperado");
}

function createResponse(): {
  headers: Map<string, string>;
  statusCode: number | null;
  body: unknown;
  response: Record<string, unknown>;
} {
  const headers = new Map<string, string>();
  const state = { statusCode: null as number | null, body: undefined as unknown };
  const response: Record<string, unknown> = {
    setHeader(name: string, value: string) {
      headers.set(name, String(value));
    },
    status(code: number) {
      state.statusCode = code;
      return response;
    },
    json(body: unknown) {
      state.body = body;
      return response;
    },
  };
  return {
    headers,
    get statusCode() {
      return state.statusCode;
    },
    get body() {
      return state.body;
    },
    response,
  };
}

async function main(): Promise<void> {
  const suffix = randomBytes(4).toString("hex");
  const containerName = `pp030-redis-auth-${suffix}`;
  const password = randomBytes(32).toString("hex");
  const containerEnv = { ...process.env, REDIS_PASSWORD: password };
  let queueService: { getHealth(): Promise<{ status: string }>; onModuleDestroy(): Promise<void> } | null = null;
  let workerQueue: Queue | null = null;
  let rateLimit: { use(req: unknown, res: unknown, next: () => void): Promise<void>; close(): Promise<void> } | null = null;
  let fallbackRateLimit: typeof rateLimit = null;
  let probe: Redis | null = null;

  try {
    requireSuccess(
      docker(
        [
          "run",
          "-d",
          "--rm",
          "--name",
          containerName,
          "-p",
          "127.0.0.1::6379",
          "-e",
          "REDIS_PASSWORD",
          "redis:7-alpine",
          "/bin/sh",
          "-ec",
          'exec redis-server --save "" --appendonly no --requirepass "$REDIS_PASSWORD"',
        ],
        containerEnv,
      ),
      "subida do Redis efemero",
    );
    await waitForRedis(containerName, password);

    const unauthenticated = docker(["exec", containerName, "redis-cli", "ping"]);
    assert.match(
      `${unauthenticated.stdout}\n${unauthenticated.stderr}`,
      /NOAUTH Authentication required/i,
    );
    console.log("T-I-01 pass: conexao sem credencial rejeitada por Redis real");

    const portOutput = requireSuccess(
      docker(["port", containerName, "6379/tcp"]),
      "descoberta da porta efemera",
    );
    const port = portOutput.match(/:(\d+)\s*$/)?.[1];
    assert.ok(port, "porta publicada do Redis nao encontrada");
    const redisUrl = `redis://:${password}@127.0.0.1:${port}`;
    process.env.REDIS_URL = redisUrl;

    const { QueueService } = await import("../apps/api/src/common/queue.service");
    queueService = new QueueService();
    const queueHealth = await queueService.getHealth();
    assert.equal(queueHealth.status, "ok");
    console.log("T-I-02 pass: QueueService/BullMQ autenticou em Redis real");

    const { config } = await import("../apps/worker/src/config");
    assert.equal(config.redisUrl, redisUrl);
    workerQueue = new Queue("pp030-worker-auth-test", { connection: { url: config.redisUrl } });
    await workerQueue.waitUntilReady();
    await workerQueue.getJobCounts("waiting");
    console.log("T-I-02-worker pass: configuracao BullMQ do worker autenticou em Redis real");

    const prefix = `pp030-${suffix}`;
    process.env.RATE_LIMIT_USE_REDIS = "true";
    process.env.RATE_LIMIT_REDIS_PREFIX = prefix;
    const { SimpleRateLimitMiddleware } = await import(
      "../apps/api/src/common/simple-rate-limit.middleware"
    );
    rateLimit = new SimpleRateLimitMiddleware();
    const request = {
      ip: "127.0.0.1",
      method: "GET",
      path: "/events",
      url: "/events",
      headers: {},
      socket: { remoteAddress: "127.0.0.1" },
    };
    const first = createResponse();
    const second = createResponse();
    let nextCalls = 0;
    await rateLimit.use(request, first.response, () => {
      nextCalls += 1;
    });
    await rateLimit.use(request, second.response, () => {
      nextCalls += 1;
    });
    assert.equal(nextCalls, 2);
    probe = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
    await probe.connect();
    const keys = await probe.keys(`${prefix}:*`);
    assert.equal(keys.length, 1);
    assert.equal(await probe.get(keys[0]), "2");
    console.log("T-I-03 pass: rate limit persistiu contagem via ioredis autenticado");

    await rateLimit.close();
    rateLimit = null;
    process.env.REDIS_URL = redisUrl.replace(password, randomBytes(32).toString("hex"));
    fallbackRateLimit = new SimpleRateLimitMiddleware();
    const fallbackResponse = createResponse();
    let fallbackNextCalls = 0;
    await fallbackRateLimit.use(request, fallbackResponse.response, () => {
      fallbackNextCalls += 1;
    });
    assert.equal(fallbackNextCalls, 1);
    assert.equal(fallbackResponse.statusCode, null);
    console.log("T-I-04 pass: senha incorreta degradou para bucket local sem quebrar requisicao");
  } finally {
    await fallbackRateLimit?.close();
    await rateLimit?.close();
    await probe?.quit().catch(() => undefined);
    await workerQueue?.close().catch(() => undefined);
    await queueService?.onModuleDestroy().catch(() => undefined);
    docker(["rm", "-f", containerName]);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
