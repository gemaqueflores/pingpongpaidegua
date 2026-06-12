import { DiscoveredCategory, parseDxPayloads } from "@cbtm/parser";
import { createHash } from "node:crypto";
import {
  buildEventScrapePolicy,
  compactWhitespace,
  computeEventSituation,
  detectWalkover,
  extractWarningCode,
  isOperationalRecoveryWarning,
  normalizeText,
  shouldClearCompetitiveDataOnManualStage2,
} from "@cbtm/shared";
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

interface PostScrapeSummary {
  warningsBySeverity: {
    high: number;
    medium: number;
    low: number;
  };
  conflictAutofix: {
    poolSize: number;
    scanned: number;
    backlogPending: number;
    noCandidatesInPool: number;
    resolved: number;
    resolvedByAliasExact: number;
    skippedAmbiguous: number;
    skippedInvalidCandidate: number;
    disabled: boolean;
  };
}

interface ScrapeConformanceAudit {
  categoryCountExpected: number;
  categoryCountObserved: number;
  registrationMismatches: number;
  matchMismatches: number;
  playedMatchMismatches: number;
  expectedRegistrationsTotal: number;
  observedRegistrationsTotal: number;
  expectedMatchesTotal: number;
  expectedPlayedMatchesTotal: number;
  observedMatchesTotal: number;
  observedWalkoverMatchesTotal: number;
  observedPlayedMatchesTotal: number;
  pendingConflicts: number;
  eliminatoriaMatchesObserved: number;
  athleteCategoryRuleViolations: number;
  samples: string[];
}

type CategoryKindForAudit = "RATING" | "RANKING";

interface RegistrationSyncDecisionInput {
  manualForceStage: ManualForceStage;
  captureInscricoes: boolean;
  currentAthletesBefore: number;
  observedRegistrationAthletes: number;
  observedRegistrationCategoryCount: number;
  incidentalRegistrationCount: number;
}

interface RegistrationSyncDecision {
  processRegistrations: boolean;
  authoritativeRegistrationAbsence: boolean;
  dropRatio: number | null;
  guardrailReason: string | null;
  warnings: string[];
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

function isPostScrapeReprocessReason(reason?: string): boolean {
  return String(reason ?? "").trim().toLowerCase().startsWith("post-scrape-reprocess");
}

export function shouldProcessRegistrationsForRun(input: {
  manualForceStage: ManualForceStage;
  captureInscricoes: boolean;
}): boolean {
  // "Payload incidental" significa qualquer dado de INSCRICOES que apareca junto
  // de um run cuja policy nao marcou captureInscricoes como fonte autoritativa.
  // Nesses casos o payload pode ser parcial e nao pode dirigir sincronizacao
  // destrutiva de categorias/atletas. A sincronizacao de inscricoes so pode
  // acontecer quando o proprio run foi desenhado para capturar inscricoes e
  // nao se trata de um stage 3 focado em grupos/resultados.
  return input.captureInscricoes && input.manualForceStage !== "stage-3-resultados";
}

export function decideRegistrationSyncForRun(
  input: RegistrationSyncDecisionInput,
): RegistrationSyncDecision {
  let processRegistrations = shouldProcessRegistrationsForRun({
    manualForceStage: input.manualForceStage,
    captureInscricoes: input.captureInscricoes,
  });
  const warnings: string[] = [];

  if (!input.captureInscricoes && input.incidentalRegistrationCount > 0) {
    warnings.push(
      `REGISTRATION_SNAPSHOT_IGNORED: ${input.incidentalRegistrationCount} inscricoes vieram incidentalmente em um run sem captureInscricoes; sincronizacao destrutiva de inscricoes foi mantida desligada.`,
    );
  }

  const dropRatio =
    input.currentAthletesBefore > 0
      ? input.observedRegistrationAthletes / input.currentAthletesBefore
      : null;
  let guardrailReason: string | null = null;

  if (processRegistrations && input.captureInscricoes) {
    const hasStrongCurrentBase = input.currentAthletesBefore >= 100;
    const looksPartialSnapshot =
      input.observedRegistrationAthletes === 0 || (dropRatio !== null && dropRatio < 0.55);
    if (hasStrongCurrentBase && looksPartialSnapshot) {
      processRegistrations = false;
      guardrailReason =
        "guardrail-registration-drop: inscricoes observadas muito abaixo da base atual";
      warnings.push(
        `GUARDRAIL_REGISTRATION_DROP: sincronizacao destrutiva de inscricoes desativada neste run (${guardrailReason}, observados=${input.observedRegistrationAthletes}, base_atual=${input.currentAthletesBefore}).`,
      );
    }
  }

  return {
    processRegistrations,
    authoritativeRegistrationAbsence:
      processRegistrations &&
      input.captureInscricoes &&
      !guardrailReason &&
      input.observedRegistrationCategoryCount > 0,
    dropRatio,
    guardrailReason,
    warnings,
  };
}

function athleteNameContainsReducedTokens(shortNameNormalized: string, athleteNameDisplay: string): boolean {
  const shortTokens = normalizeText(String(shortNameNormalized ?? ""))
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  if (shortTokens.length === 0) {
    return false;
  }

  const athleteTokens = new Set(
    normalizeText(String(athleteNameDisplay ?? ""))
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean),
  );

  return shortTokens.every((token) => athleteTokens.has(token));
}

function detectCategoryKindForAudit(categoryName: string): CategoryKindForAudit | null {
  const normalized = normalizeText(String(categoryName ?? ""))
    .replace(/\s+/g, "")
    .toUpperCase();
  if (!normalized) {
    return null;
  }
  if (/^R[A-Z]{2,3}$/.test(normalized)) {
    return "RATING";
  }
  if (
    normalized.startsWith("SUB") ||
    normalized.startsWith("ADULTO") ||
    normalized.startsWith("MASTER") ||
    normalized.startsWith("ABSOLUTO")
  ) {
    return "RANKING";
  }
  return null;
}

function extractMatchKeyFromConflictContext(context: string): string {
  return String(context ?? "").replace(/:(A|B)$/i, "");
}

function parseScoreSetsForAudit(raw: Prisma.JsonValue | null | undefined): Array<{ p1: number; p2: number }> {
  if (!Array.isArray(raw)) {
    return [];
  }
  const parsed: Array<{ p1: number; p2: number }> = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const value = entry as { a?: unknown; b?: unknown; p1?: unknown; p2?: unknown };
    const p1 = Number(value.a ?? value.p1);
    const p2 = Number(value.b ?? value.p2);
    if (!Number.isFinite(p1) || !Number.isFinite(p2)) {
      continue;
    }
    parsed.push({ p1, p2 });
  }
  return parsed;
}

function isWalkoverByStoredScoreForAudit(input: {
  sets: Array<{ p1: number; p2: number }>;
  p1Sets: number | null;
  p2Sets: number | null;
  scoreRaw?: string | null;
}): boolean {
  return detectWalkover({
    sets: input.sets,
    p1Sets: input.p1Sets,
    p2Sets: input.p2Sets,
    scoreRaw: input.scoreRaw ?? null,
  }).isWalkover;
}

export class ScrapeProcessor {
  private readonly captureService = new CaptureService();
  private readonly upsertService = new UpsertService();
  private static readonly MANUAL_FORCE_LOCK_RETRY_ATTEMPTS = 20;
  private static readonly MANUAL_FORCE_LOCK_RETRY_DELAY_MS = 3000;

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
    const postScrapeOnly = isPostScrapeReprocessReason(reason);
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
    if (event.concluido && !forceScrape && !postScrapeOnly) {
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
        intervalBySituationMs: config.scrapeIntervalBySituationMs,
      },
    );

    if (postScrapeOnly) {
      try {
        await this.executePostScrapeReprocess(eventId, reason, eventSituation, baseScrapePolicy.reason);
      } finally {
        await this.releaseEventLock(eventId);
      }
      return;
    }

    const requestedScrapePolicy =
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
              fetchEliminatoria: false,
              reason: "manual-force-stage-3-resultados",
            }
          : baseScrapePolicy;
    const scrapePolicy = {
      ...requestedScrapePolicy,
      fetchEliminatoria: false,
      reason:
        requestedScrapePolicy.fetchEliminatoria
          ? `${requestedScrapePolicy.reason}|eliminatoria-hard-disabled`
          : requestedScrapePolicy.reason,
    };

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
            prisma.readModelCache.deleteMany({
              where: { eventId },
            }),
          "readModelCache.deleteMany:stage1",
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
          () => this.pruneOldScrapeRuns(eventId, config.scrapeRunRetentionLimit),
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
            () => this.pruneOldScrapeRuns(eventId, config.scrapeRunRetentionLimit),
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
      const shouldClearCompetitiveData =
        manualForceStage === "stage-2-inscricoes" &&
        shouldClearCompetitiveDataOnManualStage2(eventSituation);
      if (shouldClearCompetitiveData) {
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
          eventStartDate: event.dataInicio ?? event.inicioRealizacao ?? null,
          ratingMatchFormat: event.ratingMatchFormat ?? "RR_K1",
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
        config.stage3IncrementalEnabled &&
        !scrapePolicy.captureInscricoes &&
        scrapePolicy.captureResultados &&
        scrapePolicy.captureGrupos;
      const stage3CategoryHashes = incrementalStage3Enabled
        ? this.computeStage3CategoryHashes(capture.payloads, [])
        : {};

      let effectivePayloads = capture.payloads;
      let effectiveEliminationPayloads: typeof capture.eliminationPayloads = [];
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
        const persistedIdempotentWarnings = this.buildPersistedWarnings(idempotentWarnings);

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
                    categoriesDiscoveredAudit: capture.categoriesDiscovered.map((item) => ({
                      categoryId: item.categoryId,
                      categoryName: item.categoryName,
                      valid: item.valid,
                      registeredCount: item.registeredCount ?? null,
                      preRegisteredCount: item.preRegisteredCount ?? null,
                      totalListedCount: item.totalListedCount ?? null,
                      officialMatchesCount: item.officialMatchesCount ?? null,
                    })),
                    stage3CategoryHashes,
                    lastSuccessfulStage3At: latestCaptureState?.lastSuccessfulStage3At ?? null,
                    lastSuccessfulStage3ByCategory:
                      latestCaptureState?.lastSuccessfulStage3ByCategory ?? {},
                  },
                  eventSituation,
                  scrapePolicy: { ...scrapePolicy },
                } as unknown as Prisma.InputJsonValue,
                warnings: persistedIdempotentWarnings,
                errorMessage: null,
              },
            }),
          "scrapeRun.update:idempotent",
        );

        await this.withDbRetry(
          () => this.pruneOldScrapeRuns(eventId, config.scrapeRunRetentionLimit),
          "scrapeRun.prune:idempotent",
        );
        return;
      }

      const dataset = parseDxPayloads(event.cbtmEventId, effectivePayloads, {
        categoriesDiscovered: capture.categoriesDiscovered,
        eliminationPayloads: effectiveEliminationPayloads,
      });

      for (const payload of effectivePayloads) {
        const sanitized = this.prepareRawCapturePayload(payload.tab, payload.rawLiteral, payload.html);
        await prisma.rawCapture.create({
          data: {
            eventId,
            scrapeRunId: scrapeRun.id,
            tab: payload.tab,
            categoryId: payload.categoryId,
            rawBody: sanitized.rawBody,
            htmlBody: sanitized.htmlBody,
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
      if (manualForceStage === "stage-2-inscricoes" && !shouldClearCompetitiveData) {
        capture.warnings.push(
          `STAGE2_PRESERVOU_CONFRONTOS: limpeza competitiva ignorada na situacao '${eventSituation}' para preservar grupos/resultados publicados.`,
        );
      }
      const observedRegistrationCategoryIds = new Set(
        capture.categoriesDiscovered
          .filter((category) => category.valid)
          .map((category) => compactWhitespace(category.categoryId))
          .filter(Boolean),
      );
      const observedRegistrationCategoryNames = new Set(
        capture.categoriesDiscovered
          .filter((category) => category.valid)
          .map((category) => normalizeText(category.categoryName))
          .filter(Boolean),
      );
      const registrationSyncDecision = decideRegistrationSyncForRun({
        manualForceStage,
        captureInscricoes: scrapePolicy.captureInscricoes,
        currentAthletesBefore: currentTotalsBeforeUpsert.athletes,
        observedRegistrationAthletes,
        observedRegistrationCategoryCount: observedRegistrationCategoryIds.size,
        incidentalRegistrationCount: dataset.registrations.length,
      });
      const processRegistrations = registrationSyncDecision.processRegistrations;
      const authoritativeRegistrationAbsence =
        registrationSyncDecision.authoritativeRegistrationAbsence;
      const registrationDropRatio = registrationSyncDecision.dropRatio;
      const preUpsertGuardrailReason = registrationSyncDecision.guardrailReason;
      capture.warnings.push(...registrationSyncDecision.warnings);

      const upsertResult = await this.upsertService.upsert(eventId, dataset, {
        processRegistrations,
        authoritativeRegistrationAbsence,
        observedRegistrationCategoryIds,
        observedRegistrationCategoryNames,
      });
      const combinedWarnings = [...upsertResult.warnings, ...capture.warnings];
      const prePostWarnings = this.buildPersistedWarnings(combinedWarnings);
      const postScrape = await this.withDbRetry(
        () => this.runPostScrape(eventId, prePostWarnings),
        "postScrape.run",
      );
      combinedWarnings.push(this.formatPostScrapeSummaryWarning(postScrape));
      const conformanceAudit = await this.withDbRetry(
        () => this.runScrapeConformanceAudit(eventId, capture.categoriesDiscovered),
        "postScrape.conformanceAudit",
      );
      combinedWarnings.push(...this.buildConformanceWarnings(conformanceAudit));
      const strictGate = {
        enabled: config.scrapeStrictQualityGateEnabled,
        applied: false,
        violated: false,
        reasons: [] as string[],
      };
      const eventIsConcluded = Boolean(event.concluido) || eventSituation === "POS_EVENTO";
      if (strictGate.enabled && eventIsConcluded) {
        strictGate.applied = true;
        if (
          config.scrapeStrictRequireZeroPendingConflicts &&
          postScrape.conflictAutofix.backlogPending > 0
        ) {
          strictGate.reasons.push(
            `conflitos_pendentes=${postScrape.conflictAutofix.backlogPending}`,
          );
        }
        if (
          config.scrapeStrictRequireZeroNoCandidateConflicts &&
          postScrape.conflictAutofix.noCandidatesInPool > 0
        ) {
          strictGate.reasons.push(
            `conflitos_sem_candidatos_pool=${postScrape.conflictAutofix.noCandidatesInPool}`,
          );
        }
        if (config.scrapeStrictRequireConformance) {
          if (conformanceAudit.categoryCountExpected !== conformanceAudit.categoryCountObserved) {
            strictGate.reasons.push(
              `auditoria_categorias=${conformanceAudit.categoryCountObserved}/${conformanceAudit.categoryCountExpected}`,
            );
          }
          if (conformanceAudit.registrationMismatches > 0) {
            strictGate.reasons.push(
              `auditoria_inscricoes_divergencias=${conformanceAudit.registrationMismatches}`,
            );
          }
          if (conformanceAudit.matchMismatches > 0) {
            strictGate.reasons.push(
              `auditoria_partidas_divergencias=${conformanceAudit.matchMismatches}`,
            );
          }
          if (conformanceAudit.playedMatchMismatches > 0) {
            strictGate.reasons.push(
              `auditoria_partidas_jogadas_divergencias=${conformanceAudit.playedMatchMismatches}`,
            );
          }
          if (conformanceAudit.eliminatoriaMatchesObserved > 0) {
            strictGate.reasons.push(
              `auditoria_eliminatoria_detectada=${conformanceAudit.eliminatoriaMatchesObserved}`,
            );
          }
        }
        strictGate.violated = strictGate.reasons.length > 0;
        if (strictGate.violated) {
          combinedWarnings.push(
            `SCRAPE_STRICT_QUALITY_GATE_ALERTA: evento concluido com pendencias de confiabilidade (${strictGate.reasons.join(
              ", ",
            )}).`,
          );
        }
      }
      const persistedWarnings = this.buildPersistedWarnings(combinedWarnings);
      const httpDegradedResults = persistedWarnings.some((warning) =>
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
      let status: ScrapeStatus = persistedWarnings.length > 0 ? "PARTIAL" : "SUCCESS";
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
                  eliminationPayloadCount: 0,
                  categoriesFound: capture.categoriesDiscovered.length,
                  categoriesValid: capture.categoriesDiscovered.filter((item) => item.valid).length,
                  categoriesVisited: capture.categoriesVisited,
                  tabsVisited: capture.tabsVisited,
                  paginationRequests: capture.paginationRequests,
                  categoryDiagnostics: capture.categoryDiagnostics,
                  categoriesDiscoveredAudit: capture.categoriesDiscovered.map((item) => ({
                    categoryId: item.categoryId,
                    categoryName: item.categoryName,
                    valid: item.valid,
                    registeredCount: item.registeredCount ?? null,
                    preRegisteredCount: item.preRegisteredCount ?? null,
                    totalListedCount: item.totalListedCount ?? null,
                    officialMatchesCount: item.officialMatchesCount ?? null,
                  })),
                  registrationSnapshotAuthority: {
                    authoritativeRegistrationAbsence,
                    processRegistrations,
                    observedRegistrationAthletes,
                    observedRegistrationCategoryCount: observedRegistrationCategoryIds.size,
                    guardrailBlocked: Boolean(preUpsertGuardrailReason),
                    guardrailReason: preUpsertGuardrailReason,
                    dropRatio: registrationDropRatio,
                  },
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
                postScrape,
                conformanceAudit,
                strictQualityGate: strictGate,
                warningPersistence: {
                  rawCount: combinedWarnings.length,
                  persistedCount: persistedWarnings.length,
                },
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
              warnings: persistedWarnings,
              errorMessage: null,
            },
          }),
        "scrapeRun.update:success",
      );

      await this.withDbRetry(
        () => this.pruneOldScrapeRuns(eventId, config.scrapeRunRetentionLimit),
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
          () => this.pruneOldScrapeRuns(eventId, config.scrapeRunRetentionLimit),
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
    const scheduledMatchPhases = ["GRUPOS", "RESULTADOS"] as const;

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
    const retentionDays = Number.isFinite(config.scrapeRunRetentionDays)
      ? Math.max(0, Math.floor(config.scrapeRunRetentionDays))
      : 45;
    const retentionCutoff =
      retentionDays > 0 ? new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000) : null;

    const runs = await prisma.scrapeRun.findMany({
      where: { eventId },
      select: { id: true, startedAt: true },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    });

    if (runs.length <= keep) {
      return;
    }

    const candidates = runs.slice(keep);
    const idsToDelete = candidates
      .filter((run) => (retentionCutoff ? run.startedAt < retentionCutoff : true))
      .map((run) => run.id);
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
      retentionDays,
      deleted: idsToDelete.length,
      candidates: candidates.length,
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
      "e:0",
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
      ...[],
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

  private async runScrapeConformanceAudit(
    eventId: number,
    categoriesDiscovered: DiscoveredCategory[],
  ): Promise<ScrapeConformanceAudit> {
    const validCategories = categoriesDiscovered.filter((item) => item.valid);
    const expectedByCbtmCategoryId = new Map<
      string,
      { categoryName: string; registered: number; matches: number | null }
    >();
    for (const item of validCategories) {
      const cbtmCategoryId = String(item.categoryId ?? "").trim();
      if (!cbtmCategoryId) {
        continue;
      }
      expectedByCbtmCategoryId.set(cbtmCategoryId, {
        categoryName: String(item.categoryName ?? "").trim() || cbtmCategoryId,
        registered: Math.max(0, Number(item.registeredCount ?? 0)),
        matches: Number.isFinite(Number(item.officialMatchesCount))
          ? Math.max(0, Number(item.officialMatchesCount))
          : null,
      });
    }

    const dbCategories = await prisma.category.findMany({
      where: {
        eventId,
        cbtmCategoryId: {
          in: [...expectedByCbtmCategoryId.keys()],
        },
      },
      select: {
        id: true,
        cbtmCategoryId: true,
        name: true,
      },
    });

    const dbCategoryIdByCbtmId = new Map<string, number>();
    for (const category of dbCategories) {
      const cbtmCategoryId = String(category.cbtmCategoryId ?? "").trim();
      if (!cbtmCategoryId) {
        continue;
      }
      dbCategoryIdByCbtmId.set(cbtmCategoryId, category.id);
    }

    const categoryIds = [...dbCategoryIdByCbtmId.values()];
    const [registrationByCategory, athleteCategoryLinks, matchesByCategory, matchesForPlayedAudit, pendingConflicts, eliminatoriaMatchesObserved] =
      await Promise.all([
        categoryIds.length === 0
          ? Promise.resolve([])
          : prisma.athleteCategory.groupBy({
              by: ["categoryId"],
              where: {
                categoryId: { in: categoryIds },
                registrationStatus: "INSCRITO",
              },
              _count: { _all: true },
            }),
        categoryIds.length === 0
          ? Promise.resolve([])
          : prisma.athleteCategory.findMany({
              where: {
                categoryId: { in: categoryIds },
                registrationStatus: "INSCRITO",
                athlete: {
                  eventId,
                  createdFromWarning: false,
                },
              },
              select: {
                athleteId: true,
                category: {
                  select: {
                    name: true,
                  },
                },
                athlete: {
                  select: {
                    nameDisplay: true,
                  },
                },
              },
            }),
        categoryIds.length === 0
          ? Promise.resolve([])
          : prisma.match.groupBy({
              by: ["categoryId"],
              where: {
                eventId,
                categoryId: { in: categoryIds },
                phase: { in: ["GRUPOS", "RESULTADOS"] },
              },
              _count: { _all: true },
            }),
        categoryIds.length === 0
          ? Promise.resolve([])
          : prisma.match.findMany({
              where: {
                eventId,
                categoryId: { in: categoryIds },
                phase: { in: ["GRUPOS", "RESULTADOS"] },
              },
              select: {
                categoryId: true,
                p1Sets: true,
                p2Sets: true,
                scoreRaw: true,
                scoreSets: true,
                setsJson: true,
              },
            }),
        prisma.athleteMatchConflict.count({
          where: {
            eventId,
            resolvedAthleteId: null,
          },
        }),
        prisma.match.count({
          where: {
            eventId,
            phase: "ELIMINATORIA",
          },
        }),
      ]);

    const registrationsByCategoryId = new Map<number, number>();
    for (const row of registrationByCategory) {
      registrationsByCategoryId.set(row.categoryId, row._count._all);
    }
    const matchesByCategoryId = new Map<number, number>();
    for (const row of matchesByCategory) {
      matchesByCategoryId.set(row.categoryId, row._count._all);
    }
    const playedMatchesByCategoryId = new Map<number, number>();
    for (const row of matchesForPlayedAudit) {
      const sets = parseScoreSetsForAudit(row.scoreSets) || parseScoreSetsForAudit(row.setsJson);
      const isWalkover = isWalkoverByStoredScoreForAudit({
        sets,
        p1Sets: row.p1Sets ?? null,
        p2Sets: row.p2Sets ?? null,
        scoreRaw: row.scoreRaw ?? null,
      });
      if (isWalkover) {
        continue;
      }
      playedMatchesByCategoryId.set(
        row.categoryId,
        (playedMatchesByCategoryId.get(row.categoryId) ?? 0) + 1,
      );
    }

    let registrationMismatches = 0;
    let matchMismatches = 0;
    let playedMatchMismatches = 0;
    let expectedRegistrationsTotal = 0;
    let observedRegistrationsTotal = 0;
    let expectedMatchesTotal = 0;
    let expectedPlayedMatchesTotal = 0;
    let observedMatchesTotal = 0;
    let observedWalkoverMatchesTotal = 0;
    let observedPlayedMatchesTotal = 0;
    let athleteCategoryRuleViolations = 0;
    const samples: string[] = [];

    const linksByAthlete = new Map<
      number,
      { athleteName: string; ratingCount: number; rankingCount: number; total: number }
    >();
    for (const link of athleteCategoryLinks) {
      const kind = detectCategoryKindForAudit(link.category.name);
      const current = linksByAthlete.get(link.athleteId) ?? {
        athleteName: link.athlete.nameDisplay,
        ratingCount: 0,
        rankingCount: 0,
        total: 0,
      };
      current.total += 1;
      if (kind === "RATING") {
        current.ratingCount += 1;
      } else if (kind === "RANKING") {
        current.rankingCount += 1;
      }
      linksByAthlete.set(link.athleteId, current);
    }
    for (const [athleteId, stats] of linksByAthlete.entries()) {
      const invalid = stats.total > 3 || stats.ratingCount > 1 || stats.rankingCount > 2;
      if (!invalid) {
        continue;
      }
      athleteCategoryRuleViolations += 1;
      if (samples.length < 8) {
        samples.push(
          `regra_vinculo atleta=${stats.athleteName}#${athleteId} total=${stats.total} ranking=${stats.rankingCount} rating=${stats.ratingCount}`,
        );
      }
    }

    for (const [cbtmCategoryId, expected] of expectedByCbtmCategoryId.entries()) {
      const categoryId = dbCategoryIdByCbtmId.get(cbtmCategoryId);
      const observedRegistrations = categoryId ? registrationsByCategoryId.get(categoryId) ?? 0 : 0;
      const observedMatches = categoryId ? matchesByCategoryId.get(categoryId) ?? 0 : 0;
      const observedPlayedMatches = categoryId ? playedMatchesByCategoryId.get(categoryId) ?? 0 : 0;
      const observedWalkoverMatches = Math.max(0, observedMatches - observedPlayedMatches);

      expectedRegistrationsTotal += expected.registered;
      observedRegistrationsTotal += observedRegistrations;
      if (expected.matches !== null) {
        expectedMatchesTotal += expected.matches;
        expectedPlayedMatchesTotal += Math.max(0, expected.matches - observedWalkoverMatches);
      }
      observedMatchesTotal += observedMatches;
      observedWalkoverMatchesTotal += observedWalkoverMatches;
      observedPlayedMatchesTotal += observedPlayedMatches;

      if (expected.registered !== observedRegistrations) {
        registrationMismatches += 1;
        if (samples.length < 8) {
          samples.push(
            `${expected.categoryName}(${cbtmCategoryId}) inscritos esperado=${expected.registered} observado=${observedRegistrations}`,
          );
        }
      }

      if (expected.matches !== null && expected.matches !== observedMatches) {
        matchMismatches += 1;
        if (samples.length < 8) {
          samples.push(
            `${expected.categoryName}(${cbtmCategoryId}) partidas esperado=${expected.matches} observado=${observedMatches}`,
          );
        }
      }
      if (
        expected.matches !== null &&
        Math.max(0, expected.matches - observedWalkoverMatches) !== observedPlayedMatches
      ) {
        playedMatchMismatches += 1;
        if (samples.length < 8) {
          samples.push(
            `${expected.categoryName}(${cbtmCategoryId}) partidas_jogadas esperado=${Math.max(
              0,
              expected.matches - observedWalkoverMatches,
            )} observado=${observedPlayedMatches} wo=${observedWalkoverMatches}`,
          );
        }
      }
    }

    return {
      categoryCountExpected: expectedByCbtmCategoryId.size,
      categoryCountObserved: dbCategoryIdByCbtmId.size,
      registrationMismatches,
      matchMismatches,
      playedMatchMismatches,
      expectedRegistrationsTotal,
      observedRegistrationsTotal,
      expectedMatchesTotal,
      expectedPlayedMatchesTotal,
      observedMatchesTotal,
      observedWalkoverMatchesTotal,
      observedPlayedMatchesTotal,
      pendingConflicts,
      eliminatoriaMatchesObserved,
      athleteCategoryRuleViolations,
      samples,
    };
  }

  private buildConformanceWarnings(audit: ScrapeConformanceAudit): string[] {
    const warnings: string[] = [];

    if (audit.categoryCountExpected !== audit.categoryCountObserved) {
      warnings.push(
        `AUDITORIA_CATEGORIAS_DIVERGENCIA: categorias esperadas=${audit.categoryCountExpected}, observadas=${audit.categoryCountObserved}.`,
      );
    }
    if (audit.registrationMismatches > 0) {
      warnings.push(
        `AUDITORIA_INSCRICOES_DIVERGENCIA: ${audit.registrationMismatches} categoria(s) com divergencia de inscritos (esperado=${audit.expectedRegistrationsTotal}, observado=${audit.observedRegistrationsTotal}).`,
      );
    }
    if (audit.matchMismatches > 0) {
      warnings.push(
        `AUDITORIA_PARTIDAS_DIVERGENCIA: ${audit.matchMismatches} categoria(s) com divergencia de partidas (esperado=${audit.expectedMatchesTotal}, observado=${audit.observedMatchesTotal}).`,
      );
    }
    if (audit.playedMatchMismatches > 0) {
      warnings.push(
        `AUDITORIA_PARTIDAS_JOGADAS_DIVERGENCIA: ${audit.playedMatchMismatches} categoria(s) com divergencia de partidas jogadas sem WO (esperado=${audit.expectedPlayedMatchesTotal}, observado=${audit.observedPlayedMatchesTotal}, wo_observado=${audit.observedWalkoverMatchesTotal}).`,
      );
    }
    if (audit.pendingConflicts > 0) {
      warnings.push(
        `AUDITORIA_CONFLITOS_PENDENTES: ${audit.pendingConflicts} conflito(s) pendente(s) apos upsert.`,
      );
    }
    if (audit.eliminatoriaMatchesObserved > 0) {
      warnings.push(
        `AUDITORIA_ELIMINATORIA_BLOQUEADA: ${audit.eliminatoriaMatchesObserved} partida(s) com fase ELIMINATORIA detectada(s) em persistencia.`,
      );
    }
    if (audit.athleteCategoryRuleViolations > 0) {
      warnings.push(
        `AUDITORIA_REGRA_VINCULO: ${audit.athleteCategoryRuleViolations} atleta(s) violam regra de inscricao (max 2 ranking + 1 rating).`,
      );
    }
    if (audit.samples.length > 0) {
      warnings.push(`AUDITORIA_AMOSTRAS: ${audit.samples.join(" | ")}`);
    }

    return warnings;
  }

  private prepareRawCapturePayload(
    tab: string,
    rawBody: string | null | undefined,
    htmlBody: string | null | undefined,
  ): { rawBody: string; htmlBody: string } {
    const normalizedTab = String(tab ?? "").trim().toUpperCase();
    const hashOnlyTabs = new Set(config.rawCaptureHashOnlyTabs);

    const sanitizedRawBody = this.sanitizeRawCaptureText(rawBody ?? "");
    const rawBodyValue = hashOnlyTabs.has(normalizedTab)
      ? this.buildRawCaptureDigest(sanitizedRawBody)
      : this.truncateRawCaptureText(sanitizedRawBody);

    if (!config.rawCaptureStoreHtml) {
      return {
        rawBody: rawBodyValue,
        htmlBody: "",
      };
    }

    const sanitizedHtmlBody = this.sanitizeRawCaptureText(htmlBody ?? "");
    const htmlBodyValue = hashOnlyTabs.has(normalizedTab)
      ? this.buildRawCaptureDigest(sanitizedHtmlBody)
      : this.truncateRawCaptureText(sanitizedHtmlBody);

    return {
      rawBody: rawBodyValue,
      htmlBody: htmlBodyValue,
    };
  }

  private sanitizeRawCaptureText(input: string): string {
    if (!config.rawCaptureSanitizeEnabled || !input) {
      return input;
    }

    let text = input;

    text = text.replace(
      /(bearer\s+)[a-z0-9._-]+/gi,
      "$1[REDACTED_TOKEN]",
    );
    text = text.replace(
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
      "[REDACTED_EMAIL]",
    );
    text = text.replace(
      /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g,
      "[REDACTED_CPF]",
    );
    text = text.replace(
      /\b(password|senha|token|secret|authorization|cookie)=([^&\s]+)/gi,
      "$1=[REDACTED]",
    );
    text = text.replace(
      /"(password|senha|token|secret|authorization|cookie)"\s*:\s*"[^"]*"/gi,
      "\"$1\":\"[REDACTED]\"",
    );
    text = text.replace(
      /(__VIEWSTATE(?:ENCRYPTED)?|__EVENTVALIDATION)=([^&\s]+)/gi,
      "$1=[REDACTED]",
    );

    return text;
  }

  private truncateRawCaptureText(input: string): string {
    const maxChars = Math.max(0, Math.floor(config.rawCaptureMaxBodyChars));
    if (maxChars === 0 || input.length <= maxChars) {
      return input;
    }
    return `${input.slice(0, maxChars)}...[truncated:${input.length}]`;
  }

  private buildRawCaptureDigest(input: string): string {
    const digest = createHash("sha256").update(input).digest("hex");
    return `[SANITIZED_HASH:${digest}]`;
  }

  private formatPostScrapeSummaryWarning(postScrape: PostScrapeSummary): string {
    return `POST_SCRAPE_SUMMARY: warnings(high=${postScrape.warningsBySeverity.high}, medium=${postScrape.warningsBySeverity.medium}, low=${postScrape.warningsBySeverity.low}); conflicts(pool=${postScrape.conflictAutofix.poolSize}, sem_candidatos_pool=${postScrape.conflictAutofix.noCandidatesInPool}, analisados=${postScrape.conflictAutofix.scanned}, resolvidos=${postScrape.conflictAutofix.resolved}, alias_exato=${postScrape.conflictAutofix.resolvedByAliasExact}, ambiguos=${postScrape.conflictAutofix.skippedAmbiguous}, invalidos=${postScrape.conflictAutofix.skippedInvalidCandidate}, backlog=${postScrape.conflictAutofix.backlogPending}, disabled=${postScrape.conflictAutofix.disabled ? "sim" : "nao"}).`;
  }

  private buildPersistedWarnings(rawWarnings: string[]): string[] {
    const normalized = rawWarnings
      .map((warning) => String(warning ?? "").trim())
      .filter(Boolean);

    const persistedCritical = new Set<string>();
    const persistedHigh = new Set<string>();
    const persistedMedium = new Set<string>();
    let conflictAthleteCount = 0;
    let mergeWarningCount = 0;
    let droppedNoise = 0;
    const aggregatedNoise = new Map<string, number>();
    const conflictByCategory = new Map<string, number>();
    let postScrapeBacklog: number | null = null;
    let postScrapeResolved: number | null = null;
    const addNoise = (key: string) => {
      aggregatedNoise.set(key, (aggregatedNoise.get(key) ?? 0) + 1);
    };

    for (const warning of normalized) {
      const text = warning.toLowerCase();
      const warningCode = extractWarningCode(warning);

      if (text.startsWith("post_scrape_summary")) {
        const backlogMatch = warning.match(/\bbacklog=(\d+)\b/i);
        if (backlogMatch?.[1]) {
          const parsedBacklog = Number(backlogMatch[1]);
          if (Number.isFinite(parsedBacklog) && parsedBacklog >= 0) {
            postScrapeBacklog = Math.floor(parsedBacklog);
          }
        }
        const resolvedMatch = warning.match(/\bresolvidos=(\d+)\b/i);
        if (resolvedMatch?.[1]) {
          const parsedResolved = Number(resolvedMatch[1]);
          if (Number.isFinite(parsedResolved) && parsedResolved >= 0) {
            postScrapeResolved = Math.floor(parsedResolved);
          }
        }
      }

      if (text.startsWith("conflito de atleta")) {
        conflictAthleteCount += 1;
        const categoryMatch = warning.match(/^Conflito de atleta \((.+?)\) em /i);
        const categoryLabel = compactWhitespace(categoryMatch?.[1] ?? "CATEGORIA_DESCONHECIDA");
        conflictByCategory.set(categoryLabel, (conflictByCategory.get(categoryLabel) ?? 0) + 1);
        addNoise("conflito_de_atleta_detalhe");
        continue;
      }

      if (text.startsWith("merge-warning: conflito de participantes")) {
        mergeWarningCount += 1;
        addNoise("merge_warning_detalhe");
        continue;
      }

      if (
        text.startsWith("resultados diagnostico") ||
        text.startsWith("inscricoes reconciliacao") ||
        text.startsWith("inscricoes gaps top10")
      ) {
        droppedNoise += 1;
        if (text.startsWith("resultados diagnostico")) {
          addNoise("resultados_diagnostico");
        } else if (text.startsWith("inscricoes reconciliacao")) {
          addNoise("inscricoes_reconciliacao");
        } else {
          addNoise("inscricoes_gaps_top10");
        }
        continue;
      }

      const severity = this.classifyWarningSeverity(warning);
      const isActionable =
        severity === "high" ||
        severity === "medium" ||
        isOperationalRecoveryWarning(warning);

      if (!isActionable) {
        droppedNoise += 1;
        addNoise("nao_acionavel");
        continue;
      }

      if (
        warningCode === "POST_SCRAPE_SUMMARY" ||
        warningCode === "GUARDRAIL_REGISTRATION_DROP" ||
        warningCode === "GUARDRAIL_REGRESSION" ||
        (warningCode !== null && isOperationalRecoveryWarning(warning))
      ) {
        persistedCritical.add(warning);
        continue;
      }
      if (severity === "high") {
        persistedHigh.add(warning);
        continue;
      }
      persistedMedium.add(warning);
    }

    const persisted = new Set<string>();
    for (const warning of persistedCritical.values()) {
      persisted.add(warning);
    }

    const parseLimit = (raw: string | undefined, fallback: number, min: number, max: number): number => {
      const parsed = Number(raw ?? String(fallback));
      if (!Number.isFinite(parsed)) {
        return fallback;
      }
      return Math.max(min, Math.min(max, Math.floor(parsed)));
    };
    const highLimit = parseLimit(process.env.SCRAPE_PERSISTED_WARNINGS_HIGH_MAX, 15, 5, 120);
    const mediumLimit = parseLimit(process.env.SCRAPE_PERSISTED_WARNINGS_MEDIUM_MAX, 20, 5, 180);
    const highSorted = [...persistedHigh.values()].sort((a, b) =>
      a.localeCompare(b, "pt-BR", { sensitivity: "base" }),
    );
    const mediumSorted = [...persistedMedium.values()].sort((a, b) =>
      a.localeCompare(b, "pt-BR", { sensitivity: "base" }),
    );
    for (const warning of highSorted.slice(0, highLimit)) {
      persisted.add(warning);
    }
    for (const warning of mediumSorted.slice(0, mediumLimit)) {
      persisted.add(warning);
    }
    const severityTrimmed = Math.max(0, highSorted.length - highLimit) + Math.max(0, mediumSorted.length - mediumLimit);
    if (severityTrimmed > 0) {
      persisted.add(
        `WARNINGS_SEVERIDADE_TRUNCADOS: ${severityTrimmed} item(ns) de alta/media severidade truncados por limite de persistencia.`,
      );
    }

    const pendingConflictCount = postScrapeBacklog ?? conflictAthleteCount;
    if (pendingConflictCount > 0) {
      const pendingMsg =
        postScrapeBacklog === null
          ? `CONFLITO_DE_ATLETA_PENDENTE: ${pendingConflictCount} ocorrencia(s) detectadas no run. Consulte a fila de conflitos para resolucao.`
          : `CONFLITO_DE_ATLETA_PENDENTE: ${pendingConflictCount} ocorrencia(s) pendente(s) apos o pos-scrape. Consulte a fila de conflitos para resolucao.`;
      persisted.add(pendingMsg);
      if (postScrapeBacklog === null) {
        const topCategories = [...conflictByCategory.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([category, count]) => `${category}=${count}`)
          .join(" | ");
        if (topCategories) {
          persisted.add(`CONFLITO_DE_ATLETA_TOP_CATEGORIAS: ${topCategories}.`);
        }
      }
    }
    if ((postScrapeResolved ?? 0) > 0) {
      persisted.add(
        `CONFLITO_DE_ATLETA_AUTORRESOLVIDO: ${postScrapeResolved} ocorrencia(s) resolvida(s) automaticamente no pos-scrape.`,
      );
    }

    if (mergeWarningCount > 0) {
      persisted.add(
        `MERGE_WARNING_PARTICIPANTES: ${mergeWarningCount} conflito(s) de participantes detectados durante merge.`,
      );
    }

    if (aggregatedNoise.size > 0) {
      const noiseSummary = [...aggregatedNoise.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR", { sensitivity: "base" }))
        .map(([key, count]) => `${key}=${count}`)
        .join(" | ");
      if (noiseSummary) {
        persisted.add(`WARNINGS_AGREGADOS_RUIDO: ${noiseSummary}.`);
      }
    }

    if (droppedNoise > 0) {
      persisted.add(
        `WARNINGS_FILTRADOS_RUIDO: ${droppedNoise} item(ns) diagnosticos nao acionaveis omitidos da persistencia.`,
      );
    }

    const parsedMaxPersisted = Number(process.env.SCRAPE_PERSISTED_WARNINGS_MAX ?? "60");
    const maxPersisted = Number.isFinite(parsedMaxPersisted)
      ? Math.max(10, Math.floor(parsedMaxPersisted))
      : 60;
    const sorted = [...persisted.values()].sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }));
    if (sorted.length <= maxPersisted) {
      return sorted;
    }

    return [
      ...sorted.slice(0, maxPersisted),
      `WARNINGS_TRUNCATED: ${sorted.length - maxPersisted} item(ns) adicional(is) foram truncados para reduzir ruido.`,
    ];
  }

  private classifyWarningSeverity(warning: string): "high" | "medium" | "low" {
    const text = String(warning ?? "").toLowerCase();
    const isDxCallbackWithFallback =
      text.includes("detectado erro de callback dx") && text.includes("fallback");

    if (isDxCallbackWithFallback) {
      return "medium";
    }

    if (
      text.includes("guardrail_regression") ||
      text.includes("falha") ||
      text.includes("erro") ||
      text.includes("http_degraded_results")
    ) {
      return "high";
    }
    if (
      text.includes("conflito de atleta") ||
      text.includes("merge-warning") ||
      text.includes("payloads dx invalidos")
    ) {
      return "medium";
    }
    return "low";
  }

  private async runPostScrape(eventId: number, warnings: string[]): Promise<PostScrapeSummary> {
    const warningsBySeverity = {
      high: 0,
      medium: 0,
      low: 0,
    };
    for (const warning of warnings) {
      const severity = this.classifyWarningSeverity(warning);
      warningsBySeverity[severity] += 1;
    }

    if (!config.postScrapeConflictAutofixEnabled) {
      const unresolvedCount = await prisma.athleteMatchConflict.count({
        where: {
          eventId,
          resolvedAthleteId: null,
        },
      });
      return {
        warningsBySeverity,
        conflictAutofix: {
          poolSize: unresolvedCount,
          scanned: 0,
          backlogPending: unresolvedCount,
          noCandidatesInPool: 0,
          resolved: 0,
          resolvedByAliasExact: 0,
          skippedAmbiguous: 0,
          skippedInvalidCandidate: 0,
          disabled: true,
        },
      };
    }

    const parsedMaxPerRun = Math.floor(config.postScrapeConflictAutofixMaxPerRun);
    const baseMaxPerRun = Number.isFinite(parsedMaxPerRun)
      ? Math.max(1, parsedMaxPerRun)
      : 200;
    const parsedScanMultiplier = Math.floor(config.postScrapeConflictAutofixScanMultiplier);
    const scanMultiplier = Number.isFinite(parsedScanMultiplier)
      ? Math.max(1, parsedScanMultiplier)
      : 4;
    const [event, unresolvedCount] = await Promise.all([
      prisma.event.findUnique({
        where: { id: eventId },
        select: {
          concluido: true,
          inicioInscricoes: true,
          fimInscricoes: true,
          inicioRealizacao: true,
          fimRealizacao: true,
          dataInicio: true,
          dataFim: true,
        },
      }),
      prisma.athleteMatchConflict.count({
        where: {
          eventId,
          resolvedAthleteId: null,
        },
      }),
    ]);
    const eventSituation = computeEventSituation({
      inicioInscricoes: event?.inicioInscricoes ?? null,
      fimInscricoes: event?.fimInscricoes ?? null,
      inicioRealizacao: event?.inicioRealizacao ?? null,
      fimRealizacao: event?.fimRealizacao ?? null,
      dataInicio: event?.dataInicio ?? null,
      dataFim: event?.dataFim ?? null,
    });
    const eventConcluded = Boolean(event?.concluido) || eventSituation === "POS_EVENTO";

    const maxPerRun = eventConcluded ? Math.max(baseMaxPerRun, 600) : baseMaxPerRun;
    let scanTake = Math.max(maxPerRun, maxPerRun * scanMultiplier);
    if (eventConcluded) {
      scanTake = Math.min(unresolvedCount, Math.max(scanTake, 2400));
    }

    const unresolvedPool = await prisma.athleteMatchConflict.findMany({
      where: {
        eventId,
        resolvedAthleteId: null,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: scanTake,
      select: {
        id: true,
        context: true,
        shortNameNormalized: true,
        candidateAthletes: true,
      },
    });

    let resolved = 0;
    let resolvedByAliasExact = 0;
    let skippedAmbiguous = 0;
    let skippedInvalidCandidate = 0;
    let noCandidatesInPool = 0;
    const conflictMatchLookupKeysById = new Map<number, string[]>();
    const conflictIdsByMatchKey = new Map<string, number[]>();
    for (const conflict of unresolvedPool) {
      const matchKey = extractMatchKeyFromConflictContext(conflict.context);
      const lookupKeys = new Set<string>([matchKey]);
      if (matchKey.includes("|")) {
        const legacyKey = compactWhitespace(matchKey.split("|").slice(1).join("|"));
        if (legacyKey) {
          lookupKeys.add(legacyKey);
        }
      }
      const normalizedLookupKeys = [...lookupKeys.values()].filter(Boolean);
      conflictMatchLookupKeysById.set(conflict.id, normalizedLookupKeys);
      for (const lookupKey of normalizedLookupKeys) {
        const current = conflictIdsByMatchKey.get(lookupKey) ?? [];
        current.push(conflict.id);
        conflictIdsByMatchKey.set(lookupKey, current);
      }
    }

    const matchRows = conflictIdsByMatchKey.size
      ? await prisma.match.findMany({
          where: {
            eventId,
            matchKey: { in: [...conflictIdsByMatchKey.keys()] },
          },
          select: {
            id: true,
            matchKey: true,
            categoryId: true,
          },
        })
      : [];
    const categoryByMatchKey = new Map<string, number>(
      matchRows.map((row) => [row.matchKey, row.categoryId] as const),
    );
    const categoryIds = [...new Set(matchRows.map((row) => row.categoryId))];
    const categoryRows = categoryIds.length
      ? await prisma.category.findMany({
          where: {
            id: { in: categoryIds },
          },
          select: {
            id: true,
            cbtmCategoryId: true,
            normalizedName: true,
          },
        })
      : [];
    const categoryIdentityById = new Map(
      categoryRows.map((row) => [row.id, row] as const),
    );
    const athleteCategoryRows = categoryIds.length
      ? await prisma.athleteCategory.findMany({
          where: {
            categoryId: { in: categoryIds },
          },
          select: {
            categoryId: true,
            athleteId: true,
          },
        })
      : [];
    const matchCategoryById = new Map<number, number>(
      matchRows.map((row) => [row.id, row.categoryId] as const),
    );
    const matchParticipantRows = matchRows.length
      ? await prisma.matchParticipant.findMany({
          where: {
            matchId: { in: matchRows.map((row) => row.id) },
          },
          select: {
            athleteId: true,
            matchId: true,
          },
        })
      : [];
    const athleteIdsByCategory = new Map<number, Set<number>>();
    const athleteIdsByCategoryCbtmId = new Map<string, Set<number>>();
    const athleteIdsByCategoryNormalizedName = new Map<string, Set<number>>();
    for (const row of athleteCategoryRows) {
      const current = athleteIdsByCategory.get(row.categoryId) ?? new Set<number>();
      current.add(row.athleteId);
      athleteIdsByCategory.set(row.categoryId, current);
    }
    for (const row of matchParticipantRows) {
      const athleteId = Number(row.athleteId ?? 0);
      if (!Number.isInteger(athleteId) || athleteId <= 0) {
        continue;
      }
      const categoryId = matchCategoryById.get(row.matchId);
      if (!categoryId) {
        continue;
      }
      const current = athleteIdsByCategory.get(categoryId) ?? new Set<number>();
      current.add(athleteId);
      athleteIdsByCategory.set(categoryId, current);
    }
    for (const [categoryId, athleteIds] of athleteIdsByCategory.entries()) {
      const identity = categoryIdentityById.get(categoryId);
      if (!identity) {
        continue;
      }
      const cbtmKey = String(identity.cbtmCategoryId ?? "").trim();
      if (cbtmKey) {
        const current = athleteIdsByCategoryCbtmId.get(cbtmKey) ?? new Set<number>();
        for (const athleteId of athleteIds) {
          current.add(athleteId);
        }
        athleteIdsByCategoryCbtmId.set(cbtmKey, current);
      }
      const normalizedKey = normalizeText(identity.normalizedName);
      if (normalizedKey) {
        const current = athleteIdsByCategoryNormalizedName.get(normalizedKey) ?? new Set<number>();
        for (const athleteId of athleteIds) {
          current.add(athleteId);
        }
        athleteIdsByCategoryNormalizedName.set(normalizedKey, current);
      }
    }
    const allowedAthleteIdsByConflict = new Map<number, Set<number>>();
    for (const conflict of unresolvedPool) {
      const lookupKeys = conflictMatchLookupKeysById.get(conflict.id) ?? [];
      const categoryId = lookupKeys
        .map((key) => categoryByMatchKey.get(key))
        .find((value): value is number => typeof value === "number" && Number.isInteger(value) && value > 0);
      if (!categoryId) {
        allowedAthleteIdsByConflict.set(conflict.id, new Set<number>());
        continue;
      }
      const byId = athleteIdsByCategory.get(categoryId);
      const identity = categoryIdentityById.get(categoryId);
      const byCbtmId =
        identity && identity.cbtmCategoryId
          ? athleteIdsByCategoryCbtmId.get(String(identity.cbtmCategoryId).trim())
          : undefined;
      const byNormalized =
        identity && identity.normalizedName
          ? athleteIdsByCategoryNormalizedName.get(normalizeText(identity.normalizedName))
          : undefined;
      const merged = new Set<number>();
      for (const source of [byId, byCbtmId, byNormalized]) {
        if (!source || source.size === 0) {
          continue;
        }
        for (const athleteId of source) {
          merged.add(athleteId);
        }
      }
      allowedAthleteIdsByConflict.set(conflict.id, merged);
    }
    const allAllowedAthleteIds = new Set<number>();
    for (const athleteIds of allowedAthleteIdsByConflict.values()) {
      for (const athleteId of athleteIds) {
        allAllowedAthleteIds.add(athleteId);
      }
    }

    const candidateAthleteIds = new Set<number>();
    const aliasKeys = new Set<string>();
    for (const conflict of unresolvedPool) {
      const payload = (conflict.candidateAthletes ?? {}) as {
        candidates?: Array<{ athleteId?: number; score?: number }>;
      };
      const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
      for (const candidate of candidates) {
        const athleteId = Number(candidate?.athleteId ?? 0);
        if (Number.isInteger(athleteId) && athleteId > 0) {
          candidateAthleteIds.add(athleteId);
        }
      }
      if (conflict.shortNameNormalized) {
        aliasKeys.add(conflict.shortNameNormalized);
      }
    }

    const aliases = aliasKeys.size
      ? await prisma.athleteAlias.findMany({
          where: {
            aliasNormalized: { in: [...aliasKeys.values()] },
            athlete: {
              eventId,
            },
          },
          select: {
            aliasNormalized: true,
            athleteId: true,
          },
        })
      : [];
    for (const alias of aliases) {
      candidateAthleteIds.add(alias.athleteId);
    }

    const athleteIdsToLoad = new Set<number>([...candidateAthleteIds, ...allAllowedAthleteIds]);
    const candidateAthletes = athleteIdsToLoad.size
      ? await prisma.athlete.findMany({
          where: {
            eventId,
            id: { in: [...athleteIdsToLoad.values()] },
          },
          select: { id: true, nameDisplay: true },
        })
      : [];

    const athleteNameById = new Map<number, string>(
      candidateAthletes.map((item) => [item.id, item.nameDisplay] as const),
    );
    const validAthleteIds = new Set<number>(candidateAthletes.map((item) => item.id));
    const aliasAthleteIdsByKey = new Map<string, Set<number>>();
    for (const alias of aliases) {
      const current = aliasAthleteIdsByKey.get(alias.aliasNormalized) ?? new Set<number>();
      current.add(alias.athleteId);
      aliasAthleteIdsByKey.set(alias.aliasNormalized, current);
    }
    const unresolvedContexts = [...new Set(unresolvedPool.map((item) => item.context))];
    const unresolvedShortNames = [...new Set(unresolvedPool.map((item) => item.shortNameNormalized))];
    const historicalResolvedConflicts =
      unresolvedContexts.length > 0 && unresolvedShortNames.length > 0
        ? await prisma.athleteMatchConflict.findMany({
            where: {
              eventId,
              resolvedAthleteId: { not: null },
              context: { in: unresolvedContexts },
              shortNameNormalized: { in: unresolvedShortNames },
            },
            select: {
              context: true,
              shortNameNormalized: true,
              resolvedAthleteId: true,
            },
          })
        : [];
    const historicalResolvedByKey = new Map<string, Set<number>>();
    for (const row of historicalResolvedConflicts) {
      const athleteId = Number(row.resolvedAthleteId ?? 0);
      if (!Number.isInteger(athleteId) || athleteId <= 0) {
        continue;
      }
      const key = `${row.context}|${row.shortNameNormalized}`;
      const bucket = historicalResolvedByKey.get(key) ?? new Set<number>();
      bucket.add(athleteId);
      historicalResolvedByKey.set(key, bucket);
    }

    const prioritized = unresolvedPool
      .map((conflict, index) => {
        const payload = (conflict.candidateAthletes ?? {}) as {
          candidates?: Array<{ athleteId?: number; score?: number }>;
        };
        const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
        if (candidates.length === 0) {
          noCandidatesInPool += 1;
        }
        const allowedAthleteIds = allowedAthleteIdsByConflict.get(conflict.id) ?? new Set<number>();
        const validCandidateIds = candidates
          .map((candidate) => Number(candidate?.athleteId ?? 0))
          .filter((athleteId) => Number.isInteger(athleteId) && athleteId > 0)
          .filter((athleteId) => validAthleteIds.has(athleteId))
          .filter((athleteId) => allowedAthleteIds.has(athleteId))
          .filter((athleteId) =>
            athleteNameContainsReducedTokens(
              conflict.shortNameNormalized,
              athleteNameById.get(athleteId) ?? "",
            ),
          );
        const aliasMatches = aliasAthleteIdsByKey.get(conflict.shortNameNormalized) ?? new Set<number>();
        const filteredAliasMatches = new Set<number>(
          [...aliasMatches].filter((athleteId) =>
            allowedAthleteIds.has(athleteId) &&
            athleteNameContainsReducedTokens(
              conflict.shortNameNormalized,
              athleteNameById.get(athleteId) ?? "",
            ),
          ),
        );

        let priority = 4;
        if (validCandidateIds.length === 1) {
          priority = 0;
        } else if (filteredAliasMatches.size === 1) {
          priority = 1;
        } else if (candidates.length === 1) {
          priority = 2;
        } else if (candidates.length > 1 || validCandidateIds.length > 1) {
          priority = 3;
        }

        return {
          conflict,
          index,
          candidates,
          allowedAthleteIds,
          validCandidateIds,
          aliasMatches: filteredAliasMatches,
          priority,
        };
      })
      .sort((a, b) => a.priority - b.priority || a.index - b.index)
      .slice(0, maxPerRun);

    for (const item of prioritized) {
      const { conflict, candidates, allowedAthleteIds, validCandidateIds, aliasMatches } = item;
      const payload = (conflict.candidateAthletes ?? {}) as {
        candidates?: Array<{ athleteId?: number; score?: number }>;
      };
      let resolvedAthleteId: number | null = null;
      let strategy:
        | "single_candidate"
        | "alias_exact"
        | "category_name_tokens"
        | "candidate_score_dominant"
        | "historical_context_exact"
        | null = null;

      if (validCandidateIds.length === 1) {
        resolvedAthleteId = validCandidateIds[0];
        strategy = "single_candidate";
      }

      if (!resolvedAthleteId) {
        if (aliasMatches.size === 1) {
          resolvedAthleteId = [...aliasMatches][0];
          strategy = "alias_exact";
        }
      }

      if (!resolvedAthleteId) {
        const categoryTokenMatches = [...allowedAthleteIds].filter((athleteId) =>
          athleteNameContainsReducedTokens(
            conflict.shortNameNormalized,
            athleteNameById.get(athleteId) ?? "",
          ),
        );
        if (categoryTokenMatches.length === 1) {
          resolvedAthleteId = categoryTokenMatches[0];
          strategy = "category_name_tokens";
        }
      }

      if (!resolvedAthleteId) {
        const scoredValidCandidates = candidates
          .map((candidate) => ({
            athleteId: Number(candidate?.athleteId ?? 0),
            score: Number(candidate?.score ?? 0),
          }))
          .filter((candidate) => Number.isInteger(candidate.athleteId) && candidate.athleteId > 0)
          .filter((candidate) => validAthleteIds.has(candidate.athleteId))
          .filter((candidate) => allowedAthleteIds.has(candidate.athleteId))
          .filter((candidate) =>
            athleteNameContainsReducedTokens(
              conflict.shortNameNormalized,
              athleteNameById.get(candidate.athleteId) ?? "",
            ),
          )
          .sort((a, b) => b.score - a.score);

        const top = scoredValidCandidates[0];
        const second = scoredValidCandidates[1];
        if (top && second && top.score >= 40 && top.score - second.score >= 20) {
          resolvedAthleteId = top.athleteId;
          strategy = "candidate_score_dominant";
        }
      }

      if (!resolvedAthleteId) {
        const key = `${conflict.context}|${conflict.shortNameNormalized}`;
        const historical = historicalResolvedByKey.get(key);
        if (historical && historical.size === 1) {
          const athleteId = [...historical][0];
          if (
            validAthleteIds.has(athleteId) &&
            athleteNameContainsReducedTokens(
              conflict.shortNameNormalized,
              athleteNameById.get(athleteId) ?? "",
            )
          ) {
            resolvedAthleteId = athleteId;
            strategy = "historical_context_exact";
          }
        }
      }

      if (!resolvedAthleteId || !strategy) {
        if (validCandidateIds.length > 1 || candidates.length > 1) {
          skippedAmbiguous += 1;
        } else if (candidates.length === 1 || allowedAthleteIds.size === 0) {
          skippedInvalidCandidate += 1;
        }
        continue;
      }

      await prisma.athleteMatchConflict.update({
        where: { id: conflict.id },
        data: {
          resolvedAthleteId,
          resolvedAt: new Date(),
          candidateAthletes: {
            ...(payload as Record<string, unknown>),
            postScrapeAutofix: {
              strategy,
              at: new Date().toISOString(),
            },
          } as Prisma.InputJsonValue,
        },
      });
      resolved += 1;
      if (strategy === "alias_exact") {
        resolvedByAliasExact += 1;
      }
    }

    return {
      warningsBySeverity,
      conflictAutofix: {
        poolSize: unresolvedPool.length,
        scanned: prioritized.length,
        backlogPending: Math.max(0, unresolvedCount - resolved),
        noCandidatesInPool,
        resolved,
        resolvedByAliasExact,
        skippedAmbiguous,
        skippedInvalidCandidate,
        disabled: false,
      },
    };
  }

  private async executePostScrapeReprocess(
    eventId: number,
    reason: string | undefined,
    eventSituation: ReturnType<typeof computeEventSituation>,
    policyReason: string,
  ): Promise<void> {
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
      "scrapeRun.create:post-scrape-reprocess",
    );

    try {
      const latestWarnings = await this.withDbRetry(
        async () => {
          const latest = await prisma.scrapeRun.findFirst({
            where: {
              eventId,
              id: { not: scrapeRun.id },
            },
            orderBy: [{ startedAt: "desc" }, { id: "desc" }],
            select: { warnings: true },
          });
          const rawWarnings = latest?.warnings;
          if (!Array.isArray(rawWarnings)) {
            return [] as string[];
          }
          return rawWarnings
            .map((item) => String(item ?? "").trim())
            .filter(Boolean);
        },
        "scrapeRun.latestWarnings:post-scrape-reprocess",
      );
      const postScrape = await this.withDbRetry(
        () => this.runPostScrape(eventId, latestWarnings),
        "postScrape.run:reprocess",
      );
      const warningSummary = this.formatPostScrapeSummaryWarning(postScrape);

      await this.withDbRetry(
        () =>
          prisma.scrapeRun.update({
            where: { id: scrapeRun.id },
            data: {
              finishedAt: new Date(),
              status: "SUCCESS",
              extractionStats: {
                mode: "post-scrape-reprocess",
                sourceWarningsCount: latestWarnings.length,
                postScrape,
                eventSituation,
                scrapePolicy: {
                  reason: `post-scrape-reprocess|base=${policyReason}`,
                },
              } as unknown as Prisma.InputJsonValue,
              warnings: [warningSummary],
              errorMessage: null,
            },
          }),
        "scrapeRun.update:post-scrape-reprocess",
      );

      await this.withDbRetry(
        () => this.pruneOldScrapeRuns(eventId, config.scrapeRunRetentionLimit),
        "scrapeRun.prune:post-scrape-reprocess",
      );

      log("info", "Reprocessamento de pos-scrape concluido", {
        eventId,
        scrapeRunId: scrapeRun.id,
        reason: reason ?? null,
        postScrape,
      });
    } catch (error) {
      await this.withDbRetry(
        () =>
          prisma.scrapeRun.update({
            where: { id: scrapeRun.id },
            data: {
              finishedAt: new Date(),
              status: "ERROR",
              extractionStats: {
                mode: "post-scrape-reprocess",
                eventSituation,
                scrapePolicy: {
                  reason: `post-scrape-reprocess|base=${policyReason}`,
                },
                errorAt: "executePostScrapeReprocess",
              } as unknown as Prisma.InputJsonValue,
              errorMessage: String(error),
            },
          }),
        "scrapeRun.update:post-scrape-reprocess:error",
      );
      throw error;
    }
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
          tab: { in: ["GRUPOS", "RESULTADOS"] },
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
