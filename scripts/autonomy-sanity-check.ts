import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { Queue } from "bullmq";
import { PrismaClient, ScrapeStatus } from "@prisma/client";
import {
  buildEventScrapePolicy,
  computeEventRecoveryStaleThresholdMs,
  resolveScrapeLockStaleMsFromEnv,
  shouldRunEventAutoScrape,
  resolveEventScrapeIntervalOverridesFromEnv,
} from "@cbtm/shared";

type Args = {
  strict: boolean;
  json: boolean;
};

type CheckStatus = "pass" | "warn" | "fail";

type CheckResult = {
  id: string;
  status: CheckStatus;
  message: string;
  details?: Record<string, unknown>;
};

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout em ${label} apos ${timeoutMs}ms`));
    }, timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function parseArgs(argv: string[]): Args {
  return {
    strict: argv.includes("--strict"),
    json: argv.includes("--json"),
  };
}

function loadEnv(): void {
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "apps/api/.env"),
    path.resolve(process.cwd(), "apps/worker/.env"),
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) {
      dotenv.config({ path: file, override: false });
    }
  }
}

function asInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.trunc(parsed);
}

async function checkDatabase(prismaWrite: PrismaClient, prismaRead: PrismaClient): Promise<CheckResult> {
  try {
    await withTimeout(prismaWrite.$queryRawUnsafe("SELECT 1"), 12000, "database-write");
    await withTimeout(prismaRead.$queryRawUnsafe("SELECT 1"), 12000, "database-read");
    return {
      id: "database",
      status: "pass",
      message: "Conexao read/write com banco OK.",
    };
  } catch (error) {
    return {
      id: "database",
      status: "fail",
      message: "Falha na conexao com banco.",
      details: {
        error: String(error),
      },
    };
  }
}

async function checkQueue(redisUrl: string, maxPendingJobs: number): Promise<CheckResult> {
  const queue = new Queue("scrape-event", {
    connection: {
      url: redisUrl,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true,
      retryStrategy: () => null,
    },
  });
  try {
    await withTimeout(queue.waitUntilReady(), 12000, "queue-ready");
    const counts = await withTimeout(
      queue.getJobCounts("waiting", "active", "delayed", "failed"),
      12000,
      "queue-counts",
    );
    const pending =
      Number(counts.waiting ?? 0) + Number(counts.active ?? 0) + Number(counts.delayed ?? 0);
    const status: CheckStatus = pending > maxPendingJobs ? "warn" : "pass";
    return {
      id: "queue",
      status,
      message:
        status === "pass"
          ? "Fila de scrape operacional."
          : "Fila com backlog acima do limite configurado.",
      details: {
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        delayed: counts.delayed ?? 0,
        failed: counts.failed ?? 0,
        pending,
        maxPendingJobs,
      },
    };
  } catch (error) {
    return {
      id: "queue",
      status: "fail",
      message: "Falha ao acessar fila Redis/BullMQ.",
      details: {
        error: String(error),
      },
    };
  } finally {
    await queue.close().catch(() => undefined);
  }
}

async function checkStaleLocks(prismaWrite: PrismaClient, staleLockMs: number): Promise<CheckResult> {
  try {
    const staleBefore = new Date(Date.now() - staleLockMs);
    const staleCount = await withTimeout(
      prismaWrite.event.count({
        where: {
          scrapeLockedAt: { not: null, lt: staleBefore },
        },
      }),
      12000,
      "stale-lock-count",
    );
    return {
      id: "stale-locks",
      status: staleCount > 0 ? "warn" : "pass",
      message:
        staleCount > 0
          ? "Existem locks de scrape stale; monitor deve liberar automaticamente."
          : "Sem locks stale de scrape.",
      details: {
        staleCount,
        staleLockMs,
      },
    };
  } catch (error) {
    return {
      id: "stale-locks",
      status: "fail",
      message: "Falha ao consultar locks stale.",
      details: {
        error: String(error),
      },
    };
  }
}

async function checkEventFreshness(
  prismaRead: PrismaClient,
  redisUrl: string,
  refreshMs: number,
): Promise<CheckResult> {
  const queue = new Queue("scrape-event", {
    connection: {
      url: redisUrl,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true,
      retryStrategy: () => null,
    },
  });
  const intervalOverrides = resolveEventScrapeIntervalOverridesFromEnv(process.env);

  try {
    const events = await withTimeout(
      prismaRead.event.findMany({
        where: { concluido: false },
        select: {
          id: true,
          nome: true,
          lastScrapeAt: true,
          inicioInscricoes: true,
          fimInscricoes: true,
          inicioRealizacao: true,
          fimRealizacao: true,
          dataInicio: true,
          dataFim: true,
        },
      }),
      12000,
      "active-events-query",
    );

    if (events.length === 0) {
      return {
        id: "event-freshness",
        status: "pass",
        message: "Sem eventos ativos para verificar frescor de scrape.",
      };
    }

    const jobs = await withTimeout(
      queue.getJobs(["waiting", "active", "delayed"], 0, 1000, false),
      12000,
      "queue-jobs",
    );
    const pendingByEvent = new Set<number>();
    for (const job of jobs) {
      if (job.name !== "scrape-event") continue;
      const eventId = Number((job.data as { eventId?: unknown } | undefined)?.eventId ?? 0);
      if (Number.isFinite(eventId) && eventId > 0) {
        pendingByEvent.add(eventId);
      }
    }

    const staleEvents: Array<Record<string, unknown>> = [];
    for (const event of events) {
      const policy = buildEventScrapePolicy(
        {
          inicioInscricoes: event.inicioInscricoes,
          fimInscricoes: event.fimInscricoes,
          inicioRealizacao: event.inicioRealizacao,
          fimRealizacao: event.fimRealizacao,
          dataInicio: event.dataInicio,
          dataFim: event.dataFim,
        },
        {
          intervalBySituationMs: intervalOverrides,
        },
      );
      if (!policy.autoSchedule) {
        continue;
      }

      const decision = shouldRunEventAutoScrape(event.lastScrapeAt, policy);
      if (!decision.due) {
        continue;
      }
      if (pendingByEvent.has(event.id)) {
        continue;
      }
      const staleThresholdMs = computeEventRecoveryStaleThresholdMs(policy);
      const overdueMs =
        decision.elapsedMs === null ? staleThresholdMs : Math.max(0, decision.elapsedMs - staleThresholdMs);
      if (overdueMs <= refreshMs) {
        continue;
      }
      staleEvents.push({
        eventId: event.id,
        eventName: event.nome,
        policyReason: policy.reason,
        staleThresholdMs,
        lastScrapeAt: event.lastScrapeAt ? event.lastScrapeAt.toISOString() : null,
        overdueMs,
      });
    }

    return {
      id: "event-freshness",
      status: staleEvents.length > 0 ? "warn" : "pass",
      message:
        staleEvents.length > 0
          ? "Eventos ativos com scrape atrasado sem job pendente."
          : "Eventos ativos dentro da janela de scrape.",
      details: {
        activeEvents: events.length,
        staleEvents: staleEvents.slice(0, 20),
      },
    };
  } catch (error) {
    return {
      id: "event-freshness",
      status: "fail",
      message: "Falha ao verificar frescor de eventos ativos.",
      details: {
        error: String(error),
      },
    };
  } finally {
    await queue.close().catch(() => undefined);
  }
}

async function checkRunReliability(prismaRead: PrismaClient): Promise<CheckResult> {
  let events: Array<{ id: number; nome: string }> = [];
  try {
    events = await withTimeout(
      prismaRead.event.findMany({
        where: { concluido: false },
        select: { id: true, nome: true },
      }),
      12000,
      "reliability-events-query",
    );
  } catch (error) {
    return {
      id: "run-reliability",
      status: "fail",
      message: "Falha ao carregar eventos ativos para confiabilidade de runs.",
      details: {
        error: String(error),
      },
    };
  }
  if (events.length === 0) {
    return {
      id: "run-reliability",
      status: "pass",
      message: "Sem eventos ativos para validar sequencia de runs.",
    };
  }

  const problematic: Array<Record<string, unknown>> = [];
  for (const event of events) {
    let runs: Array<{ id: number; status: ScrapeStatus }> = [];
    try {
      runs = await withTimeout(
        prismaRead.scrapeRun.findMany({
          where: { eventId: event.id },
          orderBy: [{ startedAt: "desc" }, { id: "desc" }],
          select: { id: true, status: true },
          take: 3,
        }),
        12000,
        `runs-query:event-${event.id}`,
      );
    } catch (error) {
      return {
        id: "run-reliability",
        status: "fail",
        message: `Falha ao carregar runs do evento ${event.id}.`,
        details: {
          error: String(error),
        },
      };
    }
    if (runs.length < 3) {
      continue;
    }
    const allError = runs.every((run) => run.status === ScrapeStatus.ERROR);
    if (allError) {
      problematic.push({
        eventId: event.id,
        eventName: event.nome,
        runIds: runs.map((run) => run.id),
      });
    }
  }

  return {
    id: "run-reliability",
    status: problematic.length > 0 ? "warn" : "pass",
    message:
      problematic.length > 0
        ? "Eventos ativos com 3 runs consecutivos em ERROR."
        : "Sequencia recente de runs sem falha crítica contínua.",
    details: {
      problematicEvents: problematic.slice(0, 20),
    },
  };
}

async function main(): Promise<void> {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));
  const databaseWriteUrl =
    process.env.DATABASE_URL_WRITE ??
    process.env.DATABASE_URL ??
    "postgresql://postgres:postgres@localhost:5432/cbtm";
  const databaseReadUrl =
    process.env.DATABASE_URL_READ ??
    process.env.DATABASE_URL_WRITE ??
    process.env.DATABASE_URL ??
    "postgresql://postgres:postgres@localhost:5432/cbtm";
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

  const staleLockMs = resolveScrapeLockStaleMsFromEnv(process.env);
  const maxPendingJobs = asInt(process.env.SCRAPER_AUTO_SCRAPE_MAX_PENDING_JOBS, 20);
  const refreshMs = asInt(process.env.SCRAPER_REFRESH_CRON_MS, 600000);

  const prismaWrite = new PrismaClient({
    datasourceUrl: databaseWriteUrl,
  });
  const prismaRead = new PrismaClient({
    datasourceUrl: databaseReadUrl,
  });

  try {
    const checks: CheckResult[] = [];
    const dbCheck = await checkDatabase(prismaWrite, prismaRead);
    checks.push(dbCheck);
    checks.push(await checkQueue(redisUrl, maxPendingJobs));
    if (dbCheck.status === "pass") {
      checks.push(await checkStaleLocks(prismaWrite, staleLockMs));
      checks.push(await checkEventFreshness(prismaRead, redisUrl, refreshMs));
      checks.push(await checkRunReliability(prismaRead));
    } else {
      checks.push({
        id: "stale-locks",
        status: "warn",
        message: "Check pulado: banco indisponivel.",
      });
      checks.push({
        id: "event-freshness",
        status: "warn",
        message: "Check pulado: banco indisponivel.",
      });
      checks.push({
        id: "run-reliability",
        status: "warn",
        message: "Check pulado: banco indisponivel.",
      });
    }

    const failed = checks.filter((check) => check.status === "fail");
    const warned = checks.filter((check) => check.status === "warn");
    const overall: "PASS" | "WARN" | "FAIL" =
      failed.length > 0 ? "FAIL" : warned.length > 0 ? "WARN" : "PASS";

    if (args.json) {
      console.log(
        JSON.stringify(
          {
            overall,
            strict: args.strict,
            checks,
          },
          null,
          2,
        ),
      );
    } else {
      console.log(`Autonomy Sanity Check: ${overall}`);
      for (const check of checks) {
        console.log(`- [${check.status.toUpperCase()}] ${check.id}: ${check.message}`);
        if (check.details && (check.status !== "pass" || args.strict)) {
          console.log(`  details=${JSON.stringify(check.details)}`);
        }
      }
    }

    if (overall === "FAIL" || (args.strict && overall === "WARN")) {
      process.exit(2);
    }
  } finally {
    await prismaRead.$disconnect();
    await prismaWrite.$disconnect();
  }
}

main().catch((error) => {
  console.error(String(error?.stack ?? error?.message ?? error));
  process.exit(1);
});
