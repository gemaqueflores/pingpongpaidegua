import { parseDxPayloads } from "@cbtm/parser";
import { buildEventScrapePolicy, computeEventSituation } from "@cbtm/shared";
import { ScrapeStatus } from "@prisma/client";
import { config } from "../config";
import { log } from "../logger";
import { prisma } from "../prisma";
import { CaptureService } from "../scraper/capture.service";
import { UpsertService } from "./upsert.service";

export class ScrapeProcessor {
  private readonly captureService = new CaptureService();
  private readonly upsertService = new UpsertService();

  async processEventJob(eventId: number, reason?: string): Promise<void> {
    log("info", "Iniciando processamento de scrape", {
      eventId,
      reason: reason ?? null,
    });

    const lockAcquired = await this.acquireEventLock(eventId);
    if (!lockAcquired) {
      log("warn", "Scrape ignorado por lock ativo no evento", {
        eventId,
        reason: reason ?? null,
      });
      return;
    }

    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) {
      log("warn", "Evento nao encontrado para scraping", { eventId });
      await this.releaseEventLock(eventId);
      return;
    }

    const forceScrape = reason === "scrape-now-force";
    if (event.concluido && !forceScrape) {
      log("info", "Evento concluido, scrape ignorado", {
        eventId,
        reason: reason ?? null,
        blockedBy: "completed_event_requires_manual_scrape_now",
      });
      await this.releaseEventLock(eventId);
      return;
    }

    const eventSituation = computeEventSituation(event);
    const scrapePolicy = buildEventScrapePolicy(event, {
      isManualForce: forceScrape,
      postEventGraceHours: config.postEventGraceHours,
    });

    if (!scrapePolicy.autoSchedule && !forceScrape) {
      log("info", "Evento fora da policy automatica de scrape", {
        eventId,
        reason,
        eventSituation,
        policyReason: scrapePolicy.reason,
      });
      await this.releaseEventLock(eventId);
      return;
    }

    const scrapeRun = await prisma.scrapeRun.create({
      data: {
        eventId,
        status: "PARTIAL",
        insertedCounts: {},
        updatedCounts: {},
        extractionStats: {},
        warnings: [],
      },
    });

    try {
      const capture = await Promise.race([
        this.captureService.capture(event.cbtmEventId, {
          captureInscricoes: scrapePolicy.captureInscricoes,
          captureGrupos: scrapePolicy.captureGrupos,
          captureResultados: scrapePolicy.captureResultados,
          fetchEliminatoria: scrapePolicy.fetchEliminatoria,
        }),
        new Promise<never>((_, reject) => {
          setTimeout(
            () => reject(new Error(`Timeout de captura apos ${config.scrapeCaptureTimeoutMs}ms`)),
            config.scrapeCaptureTimeoutMs,
          );
        }),
      ]);

      const dataset = parseDxPayloads(event.cbtmEventId, capture.payloads, {
        categoriesDiscovered: capture.categoriesDiscovered,
        eliminationPayloads: capture.eliminationPayloads,
      });

      for (const payload of capture.payloads) {
        await prisma.rawCapture.create({
          data: {
            eventId,
            scrapeRunId: scrapeRun.id,
            tab: payload.tab,
            categoryId: payload.categoryId,
            rawBody: payload.rawLiteral,
            htmlBody: payload.html,
          },
        });
      }

      for (const eliminationPayload of capture.eliminationPayloads) {
        await prisma.rawCapture.create({
          data: {
            eventId,
            scrapeRunId: scrapeRun.id,
            tab: "ELIMINATORIA_API",
            categoryId: eliminationPayload.categoryId,
            rawBody: eliminationPayload.rawBody,
            htmlBody: eliminationPayload.rawBody,
          },
        });
      }

      const upsertResult = await this.upsertService.upsert(eventId, dataset);
      const combinedWarnings = [...upsertResult.warnings, ...capture.warnings];
      const status: ScrapeStatus = combinedWarnings.length > 0 ? "PARTIAL" : "SUCCESS";

      await prisma.event.update({
        where: { id: eventId },
        data: {
          lastScrapeAt: new Date(),
        },
      });

      await prisma.scrapeRun.update({
        where: { id: scrapeRun.id },
        data: {
          finishedAt: new Date(),
          status,
          insertedCounts: upsertResult.inserted,
          updatedCounts: upsertResult.updated,
          extractionStats: {
            ...upsertResult.extractionStats,
            capture: {
              source: capture.source,
              payloadCount: capture.payloads.length,
              eliminationPayloadCount: capture.eliminationPayloads.length,
              categoriesFound: capture.categoriesDiscovered.length,
              categoriesValid: capture.categoriesDiscovered.filter((item) => item.valid).length,
              categoriesVisited: capture.categoriesVisited,
              tabsVisited: capture.tabsVisited,
              paginationRequests: capture.paginationRequests,
            },
            eventSituation,
            scrapePolicy: { ...scrapePolicy },
          },
          warnings: combinedWarnings,
          errorMessage: null,
        },
      });

      log("info", "Scrape concluido", {
        eventId,
        scrapeRunId: scrapeRun.id,
        status,
        source: capture.source,
        payloadCount: capture.payloads.length,
        eventSituation,
        scrapePolicy,
        reason: reason ?? null,
      });
    } catch (error) {
      await prisma.scrapeRun.update({
        where: { id: scrapeRun.id },
        data: {
          finishedAt: new Date(),
          status: "ERROR",
          extractionStats: {
            errorAt: "processEventJob",
            eventSituation,
            scrapePolicy: { ...scrapePolicy },
          },
          errorMessage: String(error),
        },
      });

      log("error", "Falha no scrape", {
        eventId,
        scrapeRunId: scrapeRun.id,
        error: String(error),
      });

      throw error;
    } finally {
      await this.releaseEventLock(eventId);
    }
  }

  async processScanOpenEvents(): Promise<void> {
    const openEvents = await prisma.event.findMany({
      where: {
        concluido: false,
      },
      select: {
        id: true,
      },
    });

    return Promise.resolve().then(async () => {
      for (const event of openEvents) {
        await prisma.$executeRaw`SELECT 1`;
        // Job fan-out ocorre no worker principal para manter fila centralizada.
      }
    });
  }

  private async acquireEventLock(eventId: number): Promise<boolean> {
    const staleBefore = new Date(Date.now() - config.scrapeLockStaleMs);
    const lock = await prisma.event.updateMany({
      where: {
        id: eventId,
        OR: [{ scrapeLockedAt: null }, { scrapeLockedAt: { lt: staleBefore } }],
      },
      data: {
        scrapeLockedAt: new Date(),
      },
    });

    return lock.count > 0;
  }

  private async releaseEventLock(eventId: number): Promise<void> {
    await prisma.event.updateMany({
      where: { id: eventId },
      data: {
        scrapeLockedAt: null,
      },
    });
  }
}
