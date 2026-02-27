import { buildEventScrapePolicy, computeEventSituation, shouldRunEventAutoScrape } from "@cbtm/shared";
import { Queue, Worker } from "bullmq";
import { config } from "./config";
import { log } from "./logger";
import { RawCaptureRetentionService } from "./pipeline/raw-capture-retention.service";
import { ReadModelPrewarmService } from "./pipeline/read-model-prewarm.service";
import { ScrapeProcessor } from "./pipeline/scrape.processor";
import { prisma } from "./prisma";

type ScrapeJobData = {
  eventId?: number;
  reason?: string;
  dryRun?: boolean;
  sourceScrapeJobId?: string;
};

async function autoConcludeExpiredEvents(): Promise<number> {
  const now = new Date();
  const updated = await prisma.event.updateMany({
    where: {
      concluido: false,
      OR: [
        {
          fimRealizacao: {
            not: null,
            lt: now,
          },
        },
        {
          fimRealizacao: null,
          dataFim: {
            not: null,
            lt: now,
          },
        },
      ],
    },
    data: {
      concluido: true,
    },
  });
  return Number(updated.count ?? 0);
}

async function bootstrap(): Promise<void> {
  await prisma.$connect();

  const connection = {
    url: config.redisUrl,
  };

  const queue = new Queue("scrape-event", { connection });
  const processor = new ScrapeProcessor();
  const retention = new RawCaptureRetentionService();
  const prewarmService = new ReadModelPrewarmService();

  const refreshLabel = `${Math.max(1, Math.round(config.refreshMs / (60 * 60 * 1000)))}h`;

  await queue.add(
    "scan-open-events",
    { reason: "startup-repeat" },
    {
      jobId: `scan-open-events-every-${refreshLabel}`,
      repeat: {
        every: config.refreshMs,
      },
      removeOnComplete: {
        age: 3600,
        count: 200,
      },
    },
  );

  if (config.rawCaptureCleanupEnabled) {
    await queue.add(
      "cleanup-raw-captures",
      { reason: "scheduled-daily-cleanup", dryRun: false },
      {
        jobId: "cleanup-raw-captures-repeat",
        repeat: {
          every: config.rawCaptureCleanupEveryMs,
        },
        removeOnComplete: {
          age: 24 * 3600,
          count: 30,
        },
      },
    );
  }

  const worker = new Worker<ScrapeJobData>(
    "scrape-event",
    async (job) => {
      if (job.name === "scan-open-events") {
        const autoConcluded = await autoConcludeExpiredEvents();
        if (autoConcluded > 0) {
          log("info", "Eventos concluidos automaticamente por data de realizacao", {
            count: autoConcluded,
          });
        }

        const queueCounts = await queue.getJobCounts("waiting", "active", "delayed");
        const pendingJobs =
          Number(queueCounts.waiting ?? 0) +
          Number(queueCounts.active ?? 0) +
          Number(queueCounts.delayed ?? 0);
        if (pendingJobs >= config.autoScrapeMaxPendingJobs) {
          log("warn", "Autoscrape adiado por backlog de fila", {
            pendingJobs,
            maxPendingJobs: config.autoScrapeMaxPendingJobs,
          });
          return;
        }
        const pendingScrapeJobs = await queue.getJobs(["waiting", "active", "delayed"], 0, 500, false);
        const pendingEventIds = new Set<number>();
        for (const pendingJob of pendingScrapeJobs) {
          if (pendingJob.name !== "scrape-event") {
            continue;
          }
          const pendingEventId = Number((pendingJob.data as ScrapeJobData | undefined)?.eventId ?? 0);
          if (Number.isInteger(pendingEventId) && pendingEventId > 0) {
            pendingEventIds.add(pendingEventId);
          }
        }

        const events = await prisma.event.findMany({
          select: {
            id: true,
            concluido: true,
            lastScrapeAt: true,
            inicioInscricoes: true,
            fimInscricoes: true,
            inicioRealizacao: true,
            fimRealizacao: true,
            dataInicio: true,
            dataFim: true,
          },
        });

        let eligibleEvents = 0;
        let cappedByScanLimit = 0;
        let concludedBlocked = 0;
        let skippedByInterval = 0;
        let skippedByPendingQueue = 0;
        const dueCandidates: Array<{
          id: number;
          reason: string;
          recommendedIntervalMs: number | null;
          priority: number;
          startTs: number;
        }> = [];
        for (const event of events) {
          if (event.concluido) {
            concludedBlocked += 1;
            continue;
          }
          if (pendingEventIds.has(event.id)) {
            skippedByPendingQueue += 1;
            continue;
          }
          const policy = buildEventScrapePolicy(event, {
          });
          if (!policy.autoSchedule) {
            continue;
          }

          const autoDecision = shouldRunEventAutoScrape(event.lastScrapeAt, policy);
          if (!autoDecision.due) {
            skippedByInterval += 1;
            continue;
          }

          eligibleEvents += 1;
          const situation = computeEventSituation({
            inicioInscricoes: event.inicioInscricoes,
            fimInscricoes: event.fimInscricoes,
            inicioRealizacao: event.inicioRealizacao,
            fimRealizacao: event.fimRealizacao,
            dataInicio: event.dataInicio,
            dataFim: event.dataFim,
          });
          const priority =
            situation === "EM_ANDAMENTO"
              ? 0
              : situation === "GRADES_PUBLICADAS_PRE_JOGO"
                ? 1
                : situation === "POS_INSCRICOES_PRE_EVENTO"
                  ? 2
                  : situation === "INSCRICOES_ABERTAS"
                    ? 3
                    : 4;
          dueCandidates.push({
            id: event.id,
            reason: `scheduled-auto-${policy.reason}`,
            recommendedIntervalMs: policy.recommendedIntervalMs,
            priority,
            startTs: event.dataInicio ? new Date(event.dataInicio).getTime() : Number.MAX_SAFE_INTEGER,
          });
        }

        dueCandidates.sort((left, right) => {
          if (left.priority !== right.priority) return left.priority - right.priority;
          if (left.startTs !== right.startTs) return left.startTs - right.startTs;
          return left.id - right.id;
        });

        const maxEnqueuedPerScan = Math.max(1, config.autoScrapeMaxEnqueuedPerScan);
        const selectedCandidates = dueCandidates.slice(0, maxEnqueuedPerScan);
        cappedByScanLimit = Math.max(0, dueCandidates.length - selectedCandidates.length);
        for (const candidate of selectedCandidates) {
          const intervalBucket = Math.max(candidate.recommendedIntervalMs ?? config.refreshMs, 1);
          const scheduledBucket = Math.floor(Date.now() / intervalBucket);
          await queue.add(
            "scrape-event",
            {
              eventId: candidate.id,
              reason: candidate.reason,
            },
            {
              jobId: `event-${candidate.id}-scheduled-${scheduledBucket}`,
            },
          );
        }

        log("info", "Scan concluido", {
          totalEvents: events.length,
          eligibleEvents,
          concludedBlocked,
          skippedByInterval,
          skippedByPendingQueue,
          enqueuedEvents: selectedCandidates.length,
          cappedByScanLimit,
          maxEnqueuedPerScan,
        });
        return;
      }

      if (job.name === "cleanup-raw-captures") {
        const result = await retention.cleanup({
          dryRun: job.data?.dryRun === true,
        });
        log("info", "Cleanup de raw captures concluido", {
          dryRun: result.dryRun,
          ...result.summary,
        });
        return;
      }

      if (job.name === "scrape-event" && job.data.eventId) {
        await processor.processEventJob(job.data.eventId, job.data.reason);
        const reason = String(job.data.reason ?? "").toLowerCase();
        const isStage1 = reason.includes("stage-1");
        if (config.readModelPrewarmEnabled && !isStage1) {
          const prewarmBucket = Math.floor(Date.now() / 60000);
          await queue.add(
            "refresh-read-model-cache",
            {
              eventId: job.data.eventId,
              reason: "post-scrape-prewarm",
              sourceScrapeJobId: String(job.id ?? ""),
            },
            {
              jobId: `prewarm-event-${job.data.eventId}-${prewarmBucket}`,
              removeOnComplete: {
                age: 3600,
                count: 500,
              },
              removeOnFail: {
                age: 86400,
                count: 1000,
              },
            },
          );
        }
      }

      if (job.name === "refresh-read-model-cache" && job.data.eventId) {
        await prewarmService.prewarmEvent(job.data.eventId);
      }
    },
    {
      connection,
      limiter: {
        max: 1,
        duration: 4000,
      },
      lockDuration: 20 * 60 * 1000,
      maxStalledCount: 1,
      concurrency: 1,
    },
  );

  worker.on("completed", (job) => {
    log("info", "Job concluido", {
      jobId: job.id,
      name: job.name,
      eventId: job.data?.eventId ?? null,
      reason: job.data?.reason ?? null,
    });
  });

  worker.on("failed", (job, error) => {
    log("error", "Job falhou", {
      jobId: job?.id,
      name: job?.name,
      eventId: job?.data?.eventId ?? null,
      reason: job?.data?.reason ?? null,
      error: String(error),
    });
  });

  const shutdown = async () => {
    await worker.close();
    await queue.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  log("info", "Worker iniciado", {
    mode: config.scraperMode,
    refreshMs: config.refreshMs,
    rawCaptureCleanupEnabled: config.rawCaptureCleanupEnabled,
    rawCaptureCleanupEveryMs: config.rawCaptureCleanupEveryMs,
  });
}

bootstrap().catch(async (error) => {
  log("error", "Falha ao iniciar worker", { error: String(error) });
  await prisma.$disconnect();
  process.exit(1);
});
