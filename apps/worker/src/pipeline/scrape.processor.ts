import { parseDxPayloads } from "@cbtm/parser";
import { createHash } from "node:crypto";
import { buildEventScrapePolicy, computeEventSituation } from "@cbtm/shared";
import { Prisma, ScrapeStatus } from "@prisma/client";
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

interface EventMatchesCleanupSummary {
  matchParticipants: number;
  matches: number;
  conflicts: number;
  rawCaptures: number;
}

interface EventDataTotals {
  athletes: number;
  categories: number;
  matches: number;
}

interface RegressionGuardrailStats {
  processRegistrationsForcedOff: boolean;
  reason: string | null;
  observedRegistrationAthletes: number;
  currentAthletesBefore: number;
  dropRatio: number | null;
  previousTotals?: EventDataTotals;
  currentTotals: EventDataTotals;
  flagged: boolean;
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

    const eventContentFlags = await this.readEventContentFlags(eventId);
    const eventSituation = computeEventSituation({
      ...event,
      ...eventContentFlags,
    });
    const baseScrapePolicy = buildEventScrapePolicy(
      {
        ...event,
        ...eventContentFlags,
      },
      {
      isManualForce: forceScrape,
      },
    );

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
              captureGrupos: true,
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
      let stage2CleanupSummary: EventMatchesCleanupSummary | null = null;
      if (manualForceStage === "stage-2-inscricoes") {
        stage2CleanupSummary = await this.withDbRetry(
          () => this.clearEventMatchesData(eventId),
          "event.clearMatchesData:stage2",
        );
      }

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

      const stageKey = this.resolveStageFingerprintKey(manualForceStage, scrapePolicy);
      const latestCaptureState = await this.withDbRetry(
        () => this.getLatestRunCaptureState(eventId, scrapeRun.id),
        "scrapeRun.getLatestCaptureState",
      );
      const incrementalStage3Enabled =
        !scrapePolicy.captureInscricoes && scrapePolicy.captureResultados && scrapePolicy.captureGrupos;
      const stage3CategoryHashes = incrementalStage3Enabled
        ? this.computeStage3CategoryHashes(capture.payloads, capture.eliminationPayloads)
        : {};

      let effectivePayloads = capture.payloads;
      let effectiveEliminationPayloads = capture.eliminationPayloads;
      let incrementalFilteredOutCategories: string[] = [];
      if (incrementalStage3Enabled && latestCaptureState?.stage3CategoryHashes) {
        const changedCategories = new Set<string>();
        for (const [categoryId, hashValue] of Object.entries(stage3CategoryHashes)) {
          if (latestCaptureState.stage3CategoryHashes[categoryId] !== hashValue) {
            changedCategories.add(categoryId);
          }
        }
        if (changedCategories.size > 0 && changedCategories.size < Object.keys(stage3CategoryHashes).length) {
          incrementalFilteredOutCategories = Object.keys(stage3CategoryHashes).filter(
            (categoryId) => !changedCategories.has(categoryId),
          );
          effectivePayloads = capture.payloads.filter(
            (payload) => !payload.categoryId || changedCategories.has(payload.categoryId),
          );
          effectiveEliminationPayloads = capture.eliminationPayloads.filter((payload) =>
            changedCategories.has(payload.categoryId),
          );
        }
      }

      const runFingerprint = this.computeRunFingerprint({
        stageKey,
        payloads: effectivePayloads,
        eliminationPayloads: effectiveEliminationPayloads,
      });
      const isIdempotentRun =
        latestCaptureState?.runFingerprint === runFingerprint && latestCaptureState?.stageKey === stageKey;

      if (isIdempotentRun) {
        const idempotentWarnings = [
          `IDEMPOTENTE: run ignorado por fingerprint repetido (${stageKey}).`,
          ...(incrementalFilteredOutCategories.length > 0
            ? [
                `INCREMENTAL_STAGE3: categorias sem mudança ignoradas (${incrementalFilteredOutCategories.length}).`,
              ]
            : []),
          ...capture.warnings,
        ];

        await this.withDbRetry(
          () =>
            prisma.event.update({
              where: { id: eventId },
              data: {
                lastScrapeAt: new Date(),
              },
            }),
          "event.update:lastScrapeAt:idempotent",
        );

        await this.withDbRetry(
          () =>
            prisma.scrapeRun.update({
              where: { id: scrapeRun.id },
              data: {
                finishedAt: new Date(),
                status: "SUCCESS",
                insertedCounts: {},
                updatedCounts: {
                  skippedByIdempotency: 1,
                },
                extractionStats: {
                  capture: {
                    source: capture.source,
                    runFingerprint,
                    stageKey,
                    idempotent: true,
                    categoriesFilteredOut: incrementalFilteredOutCategories,
                    categoryDiagnostics: capture.categoryDiagnostics,
                    stage3CategoryHashes,
                    lastSuccessfulStage3At: latestCaptureState?.lastSuccessfulStage3At ?? null,
                    lastSuccessfulStage3ByCategory:
                      latestCaptureState?.lastSuccessfulStage3ByCategory ?? {},
                  },
                  eventSituation,
                  scrapePolicy: { ...scrapePolicy },
                } as unknown as Prisma.InputJsonValue,
                warnings: idempotentWarnings,
                errorMessage: null,
              },
            }),
          "scrapeRun.update:idempotent",
        );

        await this.withDbRetry(
          () => this.pruneOldScrapeRuns(eventId, ScrapeProcessor.SCRAPE_RUN_RETENTION_LIMIT),
          "scrapeRun.prune:idempotent",
        );
        return;
      }

      const dataset = parseDxPayloads(event.cbtmEventId, effectivePayloads, {
        categoriesDiscovered: capture.categoriesDiscovered,
        eliminationPayloads: effectiveEliminationPayloads,
      });

      for (const payload of effectivePayloads) {
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

      for (const eliminationPayload of effectiveEliminationPayloads) {
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

      const currentTotalsBeforeUpsert = await this.withDbRetry(
        () => this.collectEventDataTotals(eventId),
        "event.collectTotals:beforeUpsert",
      );
      const observedRegistrationAthletes = new Set(
        dataset.registrations.map(
          (registration) => `${registration.athleteNormalizedName}|${registration.clubNormalizedName}`,
        ),
      ).size;
      let processRegistrations = manualForceStage !== "stage-3-resultados";
      let preUpsertGuardrailReason: string | null = null;
      const registrationDropRatio =
        currentTotalsBeforeUpsert.athletes > 0
          ? observedRegistrationAthletes / currentTotalsBeforeUpsert.athletes
          : null;
      if (processRegistrations && scrapePolicy.captureInscricoes) {
        const hasStrongCurrentBase = currentTotalsBeforeUpsert.athletes >= 100;
        const looksPartialSnapshot =
          observedRegistrationAthletes === 0 ||
          (registrationDropRatio !== null && registrationDropRatio < 0.55);
        if (hasStrongCurrentBase && looksPartialSnapshot) {
          processRegistrations = false;
          preUpsertGuardrailReason =
            "guardrail-registration-drop: inscricoes observadas muito abaixo da base atual";
        }
      }
      if (preUpsertGuardrailReason) {
        capture.warnings.push(
          `GUARDRAIL_REGISTRATION_DROP: sincronizacao destrutiva de inscricoes desativada neste run (${preUpsertGuardrailReason}, observados=${observedRegistrationAthletes}, base_atual=${currentTotalsBeforeUpsert.athletes}).`,
        );
      }

      const upsertResult = await this.upsertService.upsert(eventId, dataset, { processRegistrations });
      const combinedWarnings = [...upsertResult.warnings, ...capture.warnings];
      const httpDegradedResults = combinedWarnings.some((warning) =>
        String(warning ?? "").includes("HTTP_DEGRADED_RESULTS"),
      );
      const currentTotalsAfterUpsert = await this.withDbRetry(
        () => this.collectEventDataTotals(eventId),
        "event.collectTotals:afterUpsert",
      );
      const previousTotals = await this.withDbRetry(
        () => this.getLatestRunDataTotals(eventId, scrapeRun.id),
        "scrapeRun.getLatestDataTotals",
      );
      const regressionFlagged = this.isRegressionGuardrailTriggered(previousTotals, currentTotalsAfterUpsert);
      if (regressionFlagged) {
        combinedWarnings.push(
          `GUARDRAIL_REGRESSION: queda detectada nas contagens do evento (anterior=${JSON.stringify(
            previousTotals,
          )}, atual=${JSON.stringify(currentTotalsAfterUpsert)}).`,
        );
      }
      const regressionGuardrailStats: RegressionGuardrailStats = {
        processRegistrationsForcedOff: !processRegistrations && manualForceStage !== "stage-3-resultados",
        reason: preUpsertGuardrailReason,
        observedRegistrationAthletes,
        currentAthletesBefore: currentTotalsBeforeUpsert.athletes,
        dropRatio: registrationDropRatio,
        previousTotals: previousTotals ?? undefined,
        currentTotals: currentTotalsAfterUpsert,
        flagged: regressionFlagged,
      };
      const status: ScrapeStatus = combinedWarnings.length > 0 ? "PARTIAL" : "SUCCESS";
      const stage3SuccessByCategory: Record<string, string> = {
        ...(latestCaptureState?.lastSuccessfulStage3ByCategory ?? {}),
      };
      if (incrementalStage3Enabled && (status === "SUCCESS" || status === "PARTIAL")) {
        const successAt = new Date().toISOString();
        const filteredOut = new Set(incrementalFilteredOutCategories);
        for (const categoryId of Object.keys(stage3CategoryHashes)) {
          if (!filteredOut.has(categoryId)) {
            stage3SuccessByCategory[categoryId] = successAt;
          }
        }
      }

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
                  runFingerprint,
                  stageKey,
                  idempotent: false,
                  httpDegradedResults,
                  payloadCount: effectivePayloads.length,
                  eliminationPayloadCount: effectiveEliminationPayloads.length,
                  categoriesFound: capture.categoriesDiscovered.length,
                  categoriesValid: capture.categoriesDiscovered.filter((item) => item.valid).length,
                  categoriesVisited: capture.categoriesVisited,
                  tabsVisited: capture.tabsVisited,
                  paginationRequests: capture.paginationRequests,
                  categoryDiagnostics: capture.categoryDiagnostics,
                  stage3CategoryHashes,
                  lastSuccessfulStage3At:
                    incrementalStage3Enabled && (status === "SUCCESS" || status === "PARTIAL")
                      ? new Date().toISOString()
                      : latestCaptureState?.lastSuccessfulStage3At ?? null,
                  lastSuccessfulStage3ByCategory: stage3SuccessByCategory,
                  categoriesFilteredOut: incrementalFilteredOutCategories,
                },
                dataTotals: currentTotalsAfterUpsert,
                guardrail: regressionGuardrailStats,
                eventSituation,
                scrapePolicy: { ...scrapePolicy },
                stage2CleanupSummary: stage2CleanupSummary
                  ? {
                      matchParticipants: stage2CleanupSummary.matchParticipants,
                      matches: stage2CleanupSummary.matches,
                      conflicts: stage2CleanupSummary.conflicts,
                      rawCaptures: stage2CleanupSummary.rawCaptures,
                    }
                  : undefined,
              } as unknown as Prisma.InputJsonValue,
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
        payloadCount: effectivePayloads.length,
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

  private async readEventContentFlags(eventId: number): Promise<{
    hasPublishedMatches: boolean;
    hasPublishedResults: boolean;
  }> {
    const scheduledMatchPhases = ["GRUPOS", "RESULTADOS", "ELIMINATORIA"] as const;

    const [scheduledMatch, playedMatch] = await Promise.all([
      prisma.match.findFirst({
        where: {
          eventId,
          phase: { in: [...scheduledMatchPhases] },
        },
        select: { id: true },
      }),
      prisma.match.findFirst({
        where: {
          eventId,
          phase: { in: [...scheduledMatchPhases] },
          OR: [{ p1Sets: { gte: 2 } }, { p2Sets: { gte: 2 } }],
        },
        select: { id: true },
      }),
    ]);

    return {
      hasPublishedMatches: Boolean(scheduledMatch),
      hasPublishedResults: Boolean(playedMatch),
    };
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

  private async collectEventDataTotals(eventId: number): Promise<EventDataTotals> {
    const [athletes, categories, matches] = await Promise.all([
      prisma.athlete.count({
        where: {
          eventId,
          createdFromWarning: false,
        },
      }),
      prisma.category.count({
        where: { eventId },
      }),
      prisma.match.count({
        where: { eventId },
      }),
    ]);

    return {
      athletes,
      categories,
      matches,
    };
  }

  private async getLatestRunDataTotals(eventId: number, currentScrapeRunId: number): Promise<EventDataTotals | null> {
    const latest = await prisma.scrapeRun.findFirst({
      where: {
        eventId,
        id: { not: currentScrapeRunId },
        finishedAt: { not: null },
      },
      orderBy: { startedAt: "desc" },
      select: { extractionStats: true },
    });

    if (!latest || !latest.extractionStats || typeof latest.extractionStats !== "object") {
      return null;
    }

    const extraction = latest.extractionStats as Prisma.JsonObject;
    const dataTotals = extraction.dataTotals as Prisma.JsonObject | undefined;
    if (!dataTotals) {
      return null;
    }

    const athletes = Number(dataTotals.athletes ?? 0);
    const categories = Number(dataTotals.categories ?? 0);
    const matches = Number(dataTotals.matches ?? 0);
    if (!Number.isFinite(athletes) || !Number.isFinite(categories) || !Number.isFinite(matches)) {
      return null;
    }

    return {
      athletes,
      categories,
      matches,
    };
  }

  private isRegressionGuardrailTriggered(previous: EventDataTotals | null, current: EventDataTotals): boolean {
    if (!previous) {
      return false;
    }

    const athleteDropRatio = previous.athletes > 0 ? current.athletes / previous.athletes : 1;
    const categoryDropRatio = previous.categories > 0 ? current.categories / previous.categories : 1;
    const matchDropRatio = previous.matches > 0 ? current.matches / previous.matches : 1;

    if (previous.athletes >= 100 && athleteDropRatio < 0.7) {
      return true;
    }
    if (previous.categories >= 30 && categoryDropRatio < 0.75) {
      return true;
    }
    if (previous.matches >= 200 && matchDropRatio < 0.55) {
      return true;
    }
    return false;
  }

  private resolveStageFingerprintKey(
    manualForceStage: ManualForceStage,
    scrapePolicy: {
      captureInscricoes: boolean;
      captureGrupos: boolean;
      captureResultados: boolean;
      fetchEliminatoria: boolean;
    },
  ): string {
    return [
      manualForceStage,
      `i:${scrapePolicy.captureInscricoes ? 1 : 0}`,
      `g:${scrapePolicy.captureGrupos ? 1 : 0}`,
      `r:${scrapePolicy.captureResultados ? 1 : 0}`,
      `e:${scrapePolicy.fetchEliminatoria ? 1 : 0}`,
    ].join("|");
  }

  private computeRunFingerprint(input: {
    stageKey: string;
    payloads: Array<{ tab: string; categoryId?: string | null; rawLiteral: string }>;
    eliminationPayloads: Array<{ categoryId: string; rawBody: string }>;
  }): string {
    const parts = [
      ...input.payloads.map((payload) =>
        `${payload.tab}|${payload.categoryId ?? "-"}|${createHash("sha1").update(payload.rawLiteral).digest("hex")}`,
      ),
      ...input.eliminationPayloads.map(
        (payload) => `ELIMINATORIA|${payload.categoryId}|${createHash("sha1").update(payload.rawBody).digest("hex")}`,
      ),
    ].sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }));

    return createHash("sha1")
      .update(`${input.stageKey}|${parts.join("||")}`)
      .digest("hex");
  }

  private computeStage3CategoryHashes(
    payloads: Array<{ tab: string; categoryId?: string | null; rawLiteral: string }>,
    eliminationPayloads: Array<{ categoryId: string; rawBody: string }>,
  ): Record<string, string> {
    const bucket = new Map<string, string[]>();

    for (const payload of payloads) {
      const categoryId = String(payload.categoryId ?? "").trim();
      if (!categoryId) {
        continue;
      }
      if (payload.tab !== "GRUPOS" && payload.tab !== "RESULTADOS") {
        continue;
      }
      const entries = bucket.get(categoryId) ?? [];
      entries.push(`${payload.tab}:${createHash("sha1").update(payload.rawLiteral).digest("hex")}`);
      bucket.set(categoryId, entries);
    }

    for (const payload of eliminationPayloads) {
      const categoryId = String(payload.categoryId ?? "").trim();
      if (!categoryId) {
        continue;
      }
      const entries = bucket.get(categoryId) ?? [];
      entries.push(`ELIMINATORIA:${createHash("sha1").update(payload.rawBody).digest("hex")}`);
      bucket.set(categoryId, entries);
    }

    const hashes: Record<string, string> = {};
    for (const [categoryId, entries] of bucket.entries()) {
      hashes[categoryId] = createHash("sha1")
        .update(entries.sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" })).join("|"))
        .digest("hex");
    }

    return hashes;
  }

  private async getLatestRunCaptureState(
    eventId: number,
    currentScrapeRunId: number,
  ): Promise<
    | {
        runFingerprint: string | null;
        stageKey: string | null;
        stage3CategoryHashes: Record<string, string> | null;
        lastSuccessfulStage3At: string | null;
        lastSuccessfulStage3ByCategory: Record<string, string> | null;
      }
    | null
  > {
    const latest = await prisma.scrapeRun.findFirst({
      where: {
        eventId,
        id: { not: currentScrapeRunId },
        finishedAt: { not: null },
      },
      orderBy: { startedAt: "desc" },
      select: { extractionStats: true },
    });

    if (!latest || !latest.extractionStats || typeof latest.extractionStats !== "object") {
      return null;
    }

    const extraction = latest.extractionStats as Prisma.JsonObject;
    const capture = extraction.capture as Prisma.JsonObject | undefined;
    if (!capture) {
      return null;
    }

    const stage3CategoryHashesRaw = capture.stage3CategoryHashes as Prisma.JsonObject | undefined;
    const stage3CategoryHashes: Record<string, string> | null = stage3CategoryHashesRaw
      ? Object.fromEntries(
          Object.entries(stage3CategoryHashesRaw)
            .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
        )
      : null;
    const lastSuccessfulStage3ByCategoryRaw = capture.lastSuccessfulStage3ByCategory as
      | Prisma.JsonObject
      | undefined;
    const lastSuccessfulStage3ByCategory: Record<string, string> | null = lastSuccessfulStage3ByCategoryRaw
      ? Object.fromEntries(
          Object.entries(lastSuccessfulStage3ByCategoryRaw)
            .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
        )
      : null;

    return {
      runFingerprint: typeof capture.runFingerprint === "string" ? capture.runFingerprint : null,
      stageKey: typeof capture.stageKey === "string" ? capture.stageKey : null,
      stage3CategoryHashes,
      lastSuccessfulStage3At:
        typeof capture.lastSuccessfulStage3At === "string" ? capture.lastSuccessfulStage3At : null,
      lastSuccessfulStage3ByCategory,
    };
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

  private async clearEventMatchesData(eventId: number): Promise<EventMatchesCleanupSummary> {
    return prisma.$transaction(async (tx) => {
      const matches = await tx.match.findMany({
        where: { eventId },
        select: { id: true },
      });
      const matchIds = matches.map((item) => item.id);

      const deletedMatchParticipants =
        matchIds.length === 0
          ? { count: 0 }
          : await tx.matchParticipant.deleteMany({
              where: { matchId: { in: matchIds } },
            });

      const deletedConflicts = await tx.athleteMatchConflict.deleteMany({
        where: { eventId },
      });

      const deletedMatches = await tx.match.deleteMany({
        where: { eventId },
      });

      const deletedRawCaptures = await tx.rawCapture.deleteMany({
        where: {
          eventId,
          tab: { in: ["GRUPOS", "RESULTADOS", "ELIMINATORIA_API"] },
        },
      });

      return {
        matchParticipants: deletedMatchParticipants.count,
        matches: deletedMatches.count,
        conflicts: deletedConflicts.count,
        rawCaptures: deletedRawCaptures.count,
      };
    });
  }
}
