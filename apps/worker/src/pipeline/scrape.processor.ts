import { parseDxPayloads } from "@cbtm/parser";
import { buildEventScrapePolicy, computeEventSituation } from "@cbtm/shared";
import { ScrapeStatus } from "@prisma/client";
import { config } from "../config";
import { log } from "../logger";
import { prisma } from "../prisma";
import { CaptureService } from "../scraper/capture.service";
import { UpsertService } from "./upsert.service";

type ManualForceStage = "full" | "stage-1-reset" | "stage-2-inscricoes" | "stage-3-resultados";

interface EventDataCleanupSummary {
  matchParticipants: number;
  athleteCategories: number;
  athleteAliases: number;
  conflicts: number;
  matches: number;
  athletes: number;
  categories: number;
  rawCaptures: number;
  orphanClubs: number;
}

function resolveManualForceStage(reason?: string): ManualForceStage {
  const normalized = String(reason ?? "").trim().toLowerCase();
  if (!normalized.startsWith("scrape-now-force")) {
    return "full";
  }

  if (
    normalized.includes("stage-1") ||
    normalized.endsWith(":1") ||
    normalized.endsWith(":stage1")
  ) {
    return "stage-1-reset";
  }

  if (
    normalized.includes("stage-2") ||
    normalized.endsWith(":2") ||
    normalized.endsWith(":stage2")
  ) {
    return "stage-2-inscricoes";
  }

  if (
    normalized.includes("stage-3") ||
    normalized.endsWith(":3") ||
    normalized.endsWith(":stage3")
  ) {
    return "stage-3-resultados";
  }

  return "full";
}

export class ScrapeProcessor {
  private readonly captureService = new CaptureService();
  private readonly upsertService = new UpsertService();
  private static readonly MANUAL_FORCE_LOCK_RETRY_ATTEMPTS = 20;
  private static readonly MANUAL_FORCE_LOCK_RETRY_DELAY_MS = 3000;
  private static readonly SCRAPE_RUN_RETENTION_LIMIT = 5;

  private async withDbRetry<T>(operation: () => Promise<T>, step: string): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= Math.max(1, config.dbRetryAttempts); attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (attempt >= config.dbRetryAttempts) {
          break;
        }

        log("warn", "Falha transiente de banco, tentando novamente", {
          step,
          attempt,
          nextAttemptInMs: config.dbRetryDelayMs,
          error: String(error),
        });
        await new Promise((resolve) => setTimeout(resolve, config.dbRetryDelayMs));
      }
    }

    throw new Error(`Falha de banco em ${step}: ${String(lastError)}`);
  }

  async processEventJob(eventId: number, reason?: string): Promise<void> {
    log("info", "Iniciando processamento de scrape", {
      eventId,
      reason: reason ?? null,
    });

    const forceScrape = String(reason ?? "").startsWith("scrape-now-force");
    const lockAcquired = forceScrape
      ? await this.acquireEventLockWithRetry(eventId)
      : await this.acquireEventLock(eventId);
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

    const manualForceStage = forceScrape ? resolveManualForceStage(reason) : "full";
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
    const baseScrapePolicy = buildEventScrapePolicy(event, {
      isManualForce: forceScrape,
    });

    const scrapePolicy =
      manualForceStage === "stage-2-inscricoes"
        ? {
            ...baseScrapePolicy,
            captureInscricoes: true,
            captureGrupos: false,
            captureResultados: false,
            fetchEliminatoria: false,
            reason: "manual-force-stage-2-inscricoes",
          }
        : manualForceStage === "stage-3-resultados"
          ? {
              ...baseScrapePolicy,
              captureInscricoes: false,
              captureGrupos: false,
              captureResultados: true,
              fetchEliminatoria: true,
              reason: "manual-force-stage-3-resultados",
            }
          : baseScrapePolicy;

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

    const scrapeRun = await this.withDbRetry(
      () =>
        prisma.scrapeRun.create({
          data: {
            eventId,
            status: "PARTIAL",
            insertedCounts: {},
            updatedCounts: {},
            extractionStats: {},
            warnings: [],
          },
        }),
      "scrapeRun.create",
    );

    if (manualForceStage === "stage-1-reset") {
      try {
        const cleanupSummary = await this.withDbRetry(
          () => this.clearEventData(eventId),
          "event.clearData",
        );

        await this.withDbRetry(
          () =>
            prisma.event.update({
              where: { id: eventId },
              data: {
                lastScrapeAt: new Date(),
              },
            }),
          "event.update:lastScrapeAt:stage1",
        );

        await this.withDbRetry(
          () =>
            prisma.scrapeRun.update({
              where: { id: scrapeRun.id },
              data: {
                finishedAt: new Date(),
                status: "SUCCESS",
                insertedCounts: {},
                updatedCounts: {},
                extractionStats: {
                  eventSituation,
                  scrapePolicy: { ...scrapePolicy, reason: "manual-force-stage-1-reset" },
                  manualStage: "stage-1-reset",
                  cleanupSummary: { ...cleanupSummary },
                },
                warnings: [],
                errorMessage: null,
              },
            }),
          "scrapeRun.update:stage1",
        );

        await this.withDbRetry(
          () => this.pruneOldScrapeRuns(eventId, ScrapeProcessor.SCRAPE_RUN_RETENTION_LIMIT),
          "scrapeRun.prune:stage1",
        );

        log("info", "Limpeza manual concluida", {
          eventId,
          scrapeRunId: scrapeRun.id,
          cleanupSummary,
          reason: reason ?? null,
        });
        return;
      } catch (error) {
        try {
          await this.withDbRetry(
            () =>
              prisma.scrapeRun.update({
                where: { id: scrapeRun.id },
                data: {
                  finishedAt: new Date(),
                  status: "ERROR",
                  extractionStats: {
                    errorAt: "manual-stage-1-reset",
                    eventSituation,
                    scrapePolicy: { ...scrapePolicy, reason: "manual-force-stage-1-reset" },
                  },
                  errorMessage: String(error),
                },
              }),
            "scrapeRun.update:stage1:error",
          );

          await this.withDbRetry(
            () => this.pruneOldScrapeRuns(eventId, ScrapeProcessor.SCRAPE_RUN_RETENTION_LIMIT),
            "scrapeRun.prune:stage1:error",
          );
        } catch (updateError) {
          log("error", "Falha ao persistir erro da limpeza manual", {
            eventId,
            scrapeRunId: scrapeRun.id,
            error: String(updateError),
          });
        }

        log("error", "Falha na limpeza manual do evento", {
          eventId,
          scrapeRunId: scrapeRun.id,
          error: String(error),
        });
        throw error;
      } finally {
        await this.releaseEventLock(eventId);
      }
    }

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

      const processRegistrations = manualForceStage !== "stage-3-resultados";
      const upsertResult = await this.upsertService.upsert(eventId, dataset, {
        processRegistrations,
      });
      const combinedWarnings = [...upsertResult.warnings, ...capture.warnings];
      const status: ScrapeStatus = combinedWarnings.length > 0 ? "PARTIAL" : "SUCCESS";

      await this.withDbRetry(
        () =>
          prisma.event.update({
            where: { id: eventId },
            data: {
              lastScrapeAt: new Date(),
            },
          }),
        "event.update:lastScrapeAt",
      );

      await this.withDbRetry(
        () =>
          prisma.scrapeRun.update({
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
          }),
        "scrapeRun.update:success",
      );

      await this.withDbRetry(
        () => this.pruneOldScrapeRuns(eventId, ScrapeProcessor.SCRAPE_RUN_RETENTION_LIMIT),
        "scrapeRun.prune:success",
      );

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
      try {
        await this.withDbRetry(
          () =>
            prisma.scrapeRun.update({
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
            }),
          "scrapeRun.update:error",
        );

        await this.withDbRetry(
          () => this.pruneOldScrapeRuns(eventId, ScrapeProcessor.SCRAPE_RUN_RETENTION_LIMIT),
          "scrapeRun.prune:error",
        );
      } catch (updateError) {
        log("error", "Falha ao persistir erro de scrapeRun", {
          eventId,
          scrapeRunId: scrapeRun.id,
          error: String(updateError),
        });
      }

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

  private async acquireEventLockWithRetry(eventId: number): Promise<boolean> {
    for (
      let attempt = 1;
      attempt <= ScrapeProcessor.MANUAL_FORCE_LOCK_RETRY_ATTEMPTS;
      attempt += 1
    ) {
      const acquired = await this.acquireEventLock(eventId);
      if (acquired) {
        if (attempt > 1) {
          log("info", "Lock de scrape adquirido apos espera", { eventId, attempt });
        }
        return true;
      }

      if (attempt < ScrapeProcessor.MANUAL_FORCE_LOCK_RETRY_ATTEMPTS) {
        await new Promise((resolve) =>
          setTimeout(resolve, ScrapeProcessor.MANUAL_FORCE_LOCK_RETRY_DELAY_MS),
        );
      }
    }

    return false;
  }

  private async releaseEventLock(eventId: number): Promise<void> {
    await prisma.event.updateMany({
      where: { id: eventId },
      data: {
        scrapeLockedAt: null,
      },
    });
  }

  private async pruneOldScrapeRuns(eventId: number, keepLatest: number): Promise<void> {
    const keep = Math.max(1, keepLatest);
    const runs = await prisma.scrapeRun.findMany({
      where: { eventId },
      select: { id: true },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    });

    if (runs.length <= keep) {
      return;
    }

    const idsToDelete = runs.slice(keep).map((run) => run.id);
    if (idsToDelete.length === 0) {
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.rawCapture.updateMany({
        where: {
          eventId,
          scrapeRunId: { in: idsToDelete },
        },
        data: {
          scrapeRunId: null,
        },
      });

      await tx.scrapeRun.deleteMany({
        where: {
          eventId,
          id: { in: idsToDelete },
        },
      });
    });

    log("info", "Retencao de scrape runs aplicada", {
      eventId,
      kept: keep,
      deleted: idsToDelete.length,
    });
  }

  private async clearEventData(eventId: number): Promise<EventDataCleanupSummary> {
    return prisma.$transaction(async (tx) => {
      const athletes = await tx.athlete.findMany({
        where: { eventId },
        select: { id: true, clubId: true },
      });
      const athleteIds = athletes.map((item) => item.id);
      const clubIds = [...new Set(athletes.map((item) => item.clubId))];

      const matches = await tx.match.findMany({
        where: { eventId },
        select: { id: true },
      });
      const matchIds = matches.map((item) => item.id);

      const categories = await tx.category.findMany({
        where: { eventId },
        select: { id: true },
      });
      const categoryIds = categories.map((item) => item.id);

      const deletedMatchParticipants =
        matchIds.length === 0
          ? { count: 0 }
          : await tx.matchParticipant.deleteMany({
              where: { matchId: { in: matchIds } },
            });

      const deletedAthleteCategories =
        athleteIds.length === 0 || categoryIds.length === 0
          ? { count: 0 }
          : await tx.athleteCategory.deleteMany({
              where: {
                OR: [{ athleteId: { in: athleteIds } }, { categoryId: { in: categoryIds } }],
              },
            });

      const deletedAliases =
        athleteIds.length === 0
          ? { count: 0 }
          : await tx.athleteAlias.deleteMany({
              where: { athleteId: { in: athleteIds } },
            });

      const deletedConflicts = await tx.athleteMatchConflict.deleteMany({
        where: { eventId },
      });

      const deletedMatches = await tx.match.deleteMany({
        where: { eventId },
      });

      const deletedAthletes = await tx.athlete.deleteMany({
        where: { eventId },
      });

      const deletedCategories = await tx.category.deleteMany({
        where: { eventId },
      });

      const deletedRawCaptures = await tx.rawCapture.deleteMany({
        where: { eventId },
      });

      let orphanClubs = 0;
      if (clubIds.length > 0) {
        const deletedClubs = await tx.club.deleteMany({
          where: {
            id: { in: clubIds },
            athletes: { none: {} },
          },
        });
        orphanClubs = deletedClubs.count;
      }

      return {
        matchParticipants: deletedMatchParticipants.count,
        athleteCategories: deletedAthleteCategories.count,
        athleteAliases: deletedAliases.count,
        conflicts: deletedConflicts.count,
        matches: deletedMatches.count,
        athletes: deletedAthletes.count,
        categories: deletedCategories.count,
        rawCaptures: deletedRawCaptures.count,
        orphanClubs,
      };
    });
  }
}
