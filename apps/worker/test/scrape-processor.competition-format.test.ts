import assert from "node:assert/strict";
import test from "node:test";
import { config } from "../src/config";
import { ScrapeProcessor } from "../src/pipeline/scrape.processor";
import { prisma } from "../src/prisma";

test("PP-025 T-I-01a propaga competitionFormat do evento para a captura", async () => {
  let capturedOptions: Record<string, unknown> | undefined;
  const original = {
    captureTimeoutMs: config.scrapeCaptureTimeoutMs,
    eventFindUnique: prisma.event.findUnique,
    scrapeRunCreate: prisma.scrapeRun.create,
    scrapeRunUpdate: prisma.scrapeRun.update,
  };
  const processor = new ScrapeProcessor() as unknown as {
    processEventJob(eventId: number, reason?: string): Promise<void>;
    acquireEventLockWithRetry(eventId: number): Promise<boolean>;
    readEventContentFlags(eventId: number): Promise<{
      hasPublishedMatches: boolean;
      hasPublishedResults: boolean;
    }>;
    getLatestRunCaptureState(eventId: number, runId: number): Promise<unknown>;
    pruneOldScrapeRuns(eventId: number, limit: number): Promise<void>;
    releaseEventLock(eventId: number): Promise<void>;
    captureService: {
      capture(eventId: number, options: Record<string, unknown>): Promise<Record<string, unknown>>;
    };
    withDbRetry<T>(operation: () => Promise<T>, step: string): Promise<T>;
  };

  try {
    config.scrapeCaptureTimeoutMs = 1;
    processor.withDbRetry = async (operation) => operation();
    processor.acquireEventLockWithRetry = async () => true;
    processor.readEventContentFlags = async () => ({
      hasPublishedMatches: false,
      hasPublishedResults: false,
    });
    processor.getLatestRunCaptureState = async () => {
      throw new Error("interrompe apos captura");
    };
    processor.pruneOldScrapeRuns = async () => undefined;
    processor.releaseEventLock = async () => undefined;
    processor.captureService = {
      capture: async (_eventId, options) => {
        capturedOptions = options;
        return {
          payloads: [],
          rawBodies: [],
          eliminationPayloads: [],
          source: "fixture",
          warnings: [],
          categoriesDiscovered: [],
          categoriesVisited: [],
          tabsVisited: [],
          paginationRequests: 0,
          categoryDiagnostics: {},
        };
      },
    };

    prisma.event.findUnique = (async () => ({
      id: 57,
      cbtmEventId: 5828,
      nome: "Evento K1",
      competitionFormat: "K1",
      ratingMatchFormat: "RR_K1",
      concluido: false,
      inicioInscricoes: null,
      fimInscricoes: null,
      inicioRealizacao: new Date("2026-09-20T00:00:00.000Z"),
      fimRealizacao: new Date("2026-09-21T00:00:00.000Z"),
      dataInicio: new Date("2026-09-20T00:00:00.000Z"),
      dataFim: new Date("2026-09-21T00:00:00.000Z"),
      lastScrapeAt: null,
    })) as typeof prisma.event.findUnique;
    prisma.scrapeRun.create = (async () => ({ id: 2501 })) as typeof prisma.scrapeRun.create;
    prisma.scrapeRun.update = (async () => ({})) as typeof prisma.scrapeRun.update;

    await assert.rejects(
      processor.processEventJob(57, "scrape-now-force"),
      /interrompe apos captura/,
    );
    assert.equal(capturedOptions?.competitionFormat, "K1");
  } finally {
    config.scrapeCaptureTimeoutMs = original.captureTimeoutMs;
    prisma.event.findUnique = original.eventFindUnique;
    prisma.scrapeRun.create = original.scrapeRunCreate;
    prisma.scrapeRun.update = original.scrapeRunUpdate;
  }
});

test("PP-025 T-I-01b persiste contagem K1 e auditoria de conformidade no sucesso", async () => {
  const persistedUpdates: Array<Record<string, any>> = [];
  const original = {
    captureTimeoutMs: config.scrapeCaptureTimeoutMs,
    eventFindUnique: prisma.event.findUnique,
    eventUpdate: prisma.event.update,
    scrapeRunCreate: prisma.scrapeRun.create,
    scrapeRunUpdate: prisma.scrapeRun.update,
  };
  const processor = new ScrapeProcessor() as any;

  try {
    config.scrapeCaptureTimeoutMs = 1;
    processor.withDbRetry = async (operation: () => Promise<unknown>) => operation();
    processor.acquireEventLockWithRetry = async () => true;
    processor.releaseEventLock = async () => undefined;
    processor.readEventContentFlags = async () => ({
      hasPublishedMatches: false,
      hasPublishedResults: false,
    });
    processor.getLatestRunCaptureState = async () => null;
    processor.getLatestRunDataTotals = async () => null;
    processor.collectEventDataTotals = async () => ({ athletes: 4, categories: 1, matches: 3 });
    processor.pruneOldScrapeRuns = async () => undefined;
    processor.runPostScrape = async () => ({
      warningsBySeverity: { high: 0, medium: 0, low: 0 },
      conflictAutofix: {
        poolSize: 0,
        scanned: 0,
        backlogPending: 0,
        noCandidatesInPool: 0,
        resolved: 0,
        resolvedByAliasExact: 0,
        skippedAmbiguous: 0,
        skippedInvalidCandidate: 0,
        disabled: false,
      },
    });
    processor.runScrapeConformanceAudit = async () => ({
      categoryCountExpected: 1,
      categoryCountObserved: 1,
      registrationMismatches: 0,
      matchMismatches: 0,
      playedMatchMismatches: 0,
      expectedRegistrationsTotal: 4,
      observedRegistrationsTotal: 4,
      expectedMatchesTotal: 3,
      expectedPlayedMatchesTotal: 0,
      observedMatchesTotal: 3,
      observedWalkoverMatchesTotal: 0,
      observedPlayedMatchesTotal: 0,
      pendingConflicts: 0,
      eliminatoriaMatchesObserved: 0,
      athleteCategoryRuleViolations: 0,
      samples: [],
    });
    processor.captureService = {
      capture: async () => ({
        payloads: [],
        rawBodies: [],
        eliminationPayloads: [],
        source: "fixture",
        warnings: [],
        categoriesDiscovered: [
          {
            categoryId: "10",
            categoryName: "DUPLA ABSOLUTO MASC",
            valid: true,
            registeredCount: 4,
            preRegisteredCount: 0,
            totalListedCount: 4,
            officialMatchesCount: 3,
          },
        ],
        categoriesVisited: ["10"],
        tabsVisited: ["INSCRICOES"],
        paginationRequests: 0,
        categoryDiagnostics: {},
      }),
    };
    processor.upsertService = {
      upsert: async () => ({
        inserted: {},
        updated: {},
        warnings: [],
        extractionStats: {},
      }),
    };

    prisma.event.findUnique = (async () => ({
      id: 57,
      cbtmEventId: 5828,
      nome: "Evento K1",
      competitionFormat: "K1",
      ratingMatchFormat: "RR_K1",
      concluido: false,
      inicioInscricoes: null,
      fimInscricoes: null,
      inicioRealizacao: new Date("2026-09-20T00:00:00.000Z"),
      fimRealizacao: new Date("2026-09-21T00:00:00.000Z"),
      dataInicio: new Date("2026-09-20T00:00:00.000Z"),
      dataFim: new Date("2026-09-21T00:00:00.000Z"),
      lastScrapeAt: null,
    })) as typeof prisma.event.findUnique;
    prisma.event.update = (async () => ({})) as typeof prisma.event.update;
    prisma.scrapeRun.create = (async () => ({ id: 2502 })) as typeof prisma.scrapeRun.create;
    prisma.scrapeRun.update = (async (args: Record<string, any>) => {
      persistedUpdates.push(args);
      return {};
    }) as typeof prisma.scrapeRun.update;

    await processor.processEventJob(57, "scrape-now-force");

    const successUpdate = persistedUpdates.find(
      (entry) => entry.data?.extractionStats?.conformanceAudit,
    );
    assert.ok(successUpdate);
    assert.equal(
      successUpdate.data.extractionStats.capture.categoriesDiscoveredAudit[0].officialMatchesCount,
      3,
    );
    assert.equal(successUpdate.data.extractionStats.conformanceAudit.expectedMatchesTotal, 3);
  } finally {
    config.scrapeCaptureTimeoutMs = original.captureTimeoutMs;
    prisma.event.findUnique = original.eventFindUnique;
    prisma.event.update = original.eventUpdate;
    prisma.scrapeRun.create = original.scrapeRunCreate;
    prisma.scrapeRun.update = original.scrapeRunUpdate;
  }
});
