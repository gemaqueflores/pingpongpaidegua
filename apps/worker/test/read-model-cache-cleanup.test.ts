import assert from "node:assert/strict";
import test from "node:test";
import { ScrapeProcessor } from "../src/pipeline/scrape.processor";
import { prisma } from "../src/prisma";

test("T-I-03 stage-1-reset invalida espelho pelo fluxo de processamento", async () => {
  const calls: Array<{ where: { eventId: number } }> = [];
  const original = {
    eventFindUnique: prisma.event.findUnique,
    eventUpdate: prisma.event.update,
    scrapeRunCreate: prisma.scrapeRun.create,
    scrapeRunUpdate: prisma.scrapeRun.update,
    readModelCacheDeleteMany: prisma.readModelCache.deleteMany,
  };

  const processor = new ScrapeProcessor() as unknown as {
    processEventJob(eventId: number, reason?: string): Promise<void>;
    acquireEventLockWithRetry(eventId: number): Promise<boolean>;
    readEventContentFlags(eventId: number): Promise<{ groupsDefined: boolean; hasAnyMatches: boolean; hasPublishedResults: boolean }>;
    clearEventData(eventId: number): Promise<Record<string, number>>;
    pruneOldScrapeRuns(eventId: number, limit: number): Promise<void>;
  };

  try {
    processor.acquireEventLockWithRetry = async () => true;
    processor.readEventContentFlags = async () => ({
      groupsDefined: false,
      hasAnyMatches: false,
      hasPublishedResults: false,
    });
    processor.clearEventData = async () => ({
      matchParticipants: 0,
      athleteCategories: 0,
      athleteAliases: 0,
      conflicts: 0,
      matches: 0,
      athletes: 0,
      categories: 0,
      rawCaptures: 0,
      orphanClubs: 0,
    });
    processor.pruneOldScrapeRuns = async () => undefined;

    prisma.event.findUnique = (async () => ({
      id: 5691,
      nome: "Evento PP-006",
      concluido: false,
      inicioInscricoes: new Date("2026-06-01T00:00:00.000Z"),
      fimInscricoes: new Date("2026-06-10T00:00:00.000Z"),
      inicioRealizacao: new Date("2026-06-20T00:00:00.000Z"),
      fimRealizacao: new Date("2026-06-21T00:00:00.000Z"),
      dataInicio: new Date("2026-06-20T00:00:00.000Z"),
      dataFim: new Date("2026-06-21T00:00:00.000Z"),
      lastScrapeAt: null,
      groupsDefined: false,
    })) as typeof prisma.event.findUnique;
    prisma.scrapeRun.create = (async () => ({ id: 77 })) as typeof prisma.scrapeRun.create;
    prisma.event.update = (async () => ({})) as typeof prisma.event.update;
    prisma.scrapeRun.update = (async () => ({})) as typeof prisma.scrapeRun.update;
    prisma.readModelCache.deleteMany = (async (args: { where: { eventId: number } }) => {
      calls.push(args);
      return { count: 3 };
    }) as typeof prisma.readModelCache.deleteMany;

    await processor.processEventJob(5691, "scrape-now-force-stage-1-reset");

    assert.deepEqual(calls, [{ where: { eventId: 5691 } }]);
  } finally {
    prisma.event.findUnique = original.eventFindUnique;
    prisma.event.update = original.eventUpdate;
    prisma.scrapeRun.create = original.scrapeRunCreate;
    prisma.scrapeRun.update = original.scrapeRunUpdate;
    prisma.readModelCache.deleteMany = original.readModelCacheDeleteMany;
  }
});
