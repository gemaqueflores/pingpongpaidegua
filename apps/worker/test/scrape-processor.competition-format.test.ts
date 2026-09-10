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
