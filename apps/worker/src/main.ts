import { buildEventScrapePolicy } from "@cbtm/shared";
import { Queue, Worker } from "bullmq";
import { config } from "./config";
import { log } from "./logger";
import { ScrapeProcessor } from "./pipeline/scrape.processor";
import { prisma } from "./prisma";

type ScrapeJobData = {
  eventId?: number;
  reason?: string;
};

async function bootstrap(): Promise<void> {
  await prisma.$connect();

  const connection = {
    url: config.redisUrl,
  };

  const queue = new Queue("scrape-event", { connection });
  const processor = new ScrapeProcessor();

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

  const worker = new Worker<ScrapeJobData>(
    "scrape-event",
    async (job) => {
      if (job.name === "scan-open-events") {
        const events = await prisma.event.findMany({
          where: { concluido: false },
          select: {
            id: true,
            inicioInscricoes: true,
            fimInscricoes: true,
            inicioRealizacao: true,
            fimRealizacao: true,
            dataInicio: true,
            dataFim: true,
          },
        });

        let eligibleEvents = 0;
        for (const event of events) {
          const policy = buildEventScrapePolicy(event, {
            postEventGraceHours: config.postEventGraceHours,
          });
          if (!policy.autoSchedule) {
            continue;
          }

          eligibleEvents += 1;
          const scheduledBucket = Math.floor(Date.now() / config.refreshMs);
          await queue.add(
            "scrape-event",
            {
              eventId: event.id,
              reason: `scheduled-${refreshLabel}`,
            },
            {
              jobId: `event-${event.id}-scheduled-${scheduledBucket}`,
            },
          );
        }

        log("info", "Scan concluido", { openEvents: events.length, eligibleEvents });
        return;
      }

      if (job.name === "scrape-event" && job.data.eventId) {
        await processor.processEventJob(job.data.eventId, job.data.reason);
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
  });
}

bootstrap().catch(async (error) => {
  log("error", "Falha ao iniciar worker", { error: String(error) });
  await prisma.$disconnect();
  process.exit(1);
});
