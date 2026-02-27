import { buildEventScrapePolicy, shouldRunEventAutoScrape } from "@cbtm/shared";
import { config } from "./config";
import { log } from "./logger";
import { ScrapeProcessor } from "./pipeline/scrape.processor";
import { prisma } from "./prisma";

function parseEventIds(raw: string | undefined): number[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(/[;,]/g)
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value > 0);
}

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

async function run(): Promise<void> {
  await prisma.$connect();
  const processor = new ScrapeProcessor();

  const autoConcluded = await autoConcludeExpiredEvents();
  if (autoConcluded > 0) {
    log("info", "Run-once concluiu eventos automaticamente por data de realizacao", {
      count: autoConcluded,
    });
  }

  const forcedEventIds = parseEventIds(process.env.SCRAPE_EVENT_IDS);
  const where =
    forcedEventIds.length > 0
      ? { id: { in: forcedEventIds } }
      : { concluido: false };

  const events = await prisma.event.findMany({
    where,
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
    orderBy: [{ id: "asc" }],
  });

  let eligible = 0;
  let skippedByInterval = 0;
  let processed = 0;
  let failed = 0;
  const isForcedSelection = forcedEventIds.length > 0;

  for (const event of events) {
    const policy = buildEventScrapePolicy(event, {
    });
    if (!policy.autoSchedule) {
      continue;
    }

    if (!isForcedSelection) {
      const autoDecision = shouldRunEventAutoScrape(event.lastScrapeAt, policy);
      if (!autoDecision.due) {
        skippedByInterval += 1;
        continue;
      }
    }

    eligible += 1;
    try {
      await processor.processEventJob(event.id, `scheduled-auto-${policy.reason}`);
      processed += 1;
    } catch (error) {
      failed += 1;
      log("error", "Falha no run-once para evento", {
        eventId: event.id,
        error: String(error),
      });
    }
  }

  log("info", "Run-once concluido", {
    totalEvents: events.length,
    eligibleEvents: eligible,
    skippedByInterval,
    processed,
    failed,
  });

  await prisma.$disconnect();
}

run().catch(async (error) => {
  log("error", "Falha no run-once", { error: String(error) });
  await prisma.$disconnect();
  process.exit(1);
});
