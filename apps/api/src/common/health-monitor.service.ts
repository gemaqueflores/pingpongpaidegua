import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma, ScrapeStatus } from "@prisma/client";
import {
  buildEventScrapePolicy,
  computeEventRecoveryStaleThresholdMs,
  computeEventSituation,
  isOperationalRecoveryWarning,
  resolveEventScrapeIntervalOverridesFromEnv,
  resolveScrapeLockStaleMsFromEnv,
  shouldClearCompetitiveDataOnManualStage2,
} from "@cbtm/shared";
import { PrismaReadService, PrismaService } from "./prisma.service";
import { QueueService } from "./queue.service";

@Injectable()
export class HealthMonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HealthMonitorService.name);
  private timer: NodeJS.Timeout | null = null;
  private readonly enabled = process.env.HEALTH_MONITOR_ENABLED !== "false";
  private readonly intervalMs = Math.max(5000, Number(process.env.HEALTH_MONITOR_INTERVAL_MS ?? "30000"));
  private readonly recoveryEnabled = process.env.HEALTH_MONITOR_RECOVERY_ENABLED !== "false";
  private readonly staleLockMs = resolveScrapeLockStaleMsFromEnv(process.env);
  private readonly scrapeLookbackMs = Math.max(
    300000,
    Number(process.env.HEALTH_MONITOR_SCRAPE_LOOKBACK_MS ?? "5400000"),
  );
  private readonly recoveryCooldownMs = Math.max(
    60000,
    Number(process.env.HEALTH_MONITOR_RECOVERY_COOLDOWN_MS ?? "1200000"),
  );
  private readonly recoveryMaxEventsPerCycle = Math.max(
    1,
    Number(process.env.HEALTH_MONITOR_RECOVERY_MAX_EVENTS_PER_CYCLE ?? "3"),
  );
  private readonly recoveryMaxAttemptsPerEvent = Math.max(
    1,
    Number(process.env.HEALTH_MONITOR_RECOVERY_MAX_ATTEMPTS_PER_EVENT ?? "6"),
  );
  private readonly recoveryEscalateAfterConsecutiveDegraded = Math.max(
    2,
    Number(process.env.HEALTH_MONITOR_RECOVERY_ESCALATE_AFTER_CONSECUTIVE_DEGRADED ?? "2"),
  );
  private readonly recoveryAttemptWindowMs = Math.max(
    this.recoveryCooldownMs,
    Number(process.env.HEALTH_MONITOR_RECOVERY_ATTEMPT_WINDOW_MS ?? "21600000"),
  );
  private readonly lastRecoveryByEventId = new Map<number, number>();
  private readonly recoveryAttemptsByEventId = new Map<number, { count: number; startedAt: number }>();
  private readonly scrapeIntervalBySituationMs = resolveEventScrapeIntervalOverridesFromEnv(process.env);

  constructor(
    private readonly prisma: PrismaService,
    private readonly prismaRead: PrismaReadService,
    private readonly queueService: QueueService,
  ) {}

  onModuleInit(): void {
    if (!this.enabled) {
      return;
    }

    this.timer = setInterval(() => {
      void this.runChecks();
    }, this.intervalMs);
    this.timer.unref?.();
    void this.runChecks();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async runChecks(): Promise<void> {
    await this.autoConcludeExpiredEvents();
    await this.checkDatabase();
    await this.checkQueueAndRecover();
    if (this.recoveryEnabled) {
      await this.recoverStaleLocks();
      await this.recoverDegradedScrapes();
      await this.recoverStaleEventData();
    }
  }

  private async checkDatabase(): Promise<void> {
    try {
      await this.prismaRead.$queryRaw`SELECT 1`;
    } catch (error) {
      this.logger.error(
        `Healthcheck de banco falhou: ${error instanceof Error ? error.message : "erro desconhecido"}`,
      );
    }
  }

  private async autoConcludeExpiredEvents(): Promise<void> {
    const now = new Date();
    try {
      const updated = await this.prisma.event.updateMany({
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
      if (updated.count > 0) {
        this.logger.log(`Eventos concluidos automaticamente por data encerrada: ${updated.count}.`);
      }
    } catch (error) {
      this.logger.error(
        `Falha ao concluir eventos por data: ${error instanceof Error ? error.message : "erro desconhecido"}`,
      );
    }
  }

  private async checkQueueAndRecover(): Promise<void> {
    const ok = await this.queueService.ensureHealthy();
    if (!ok) {
      this.logger.error("Fila permaneceu indisponivel apos tentativa de autorecuperacao.");
    }
  }

  private async recoverStaleLocks(): Promise<void> {
    const staleCutoff = new Date(Date.now() - this.staleLockMs);
    try {
      const updated = await this.prisma.event.updateMany({
        where: {
          scrapeLockedAt: {
            not: null,
            lt: staleCutoff,
          },
        },
        data: {
          scrapeLockedAt: null,
        },
      });
      if (updated.count > 0) {
        this.logger.warn(`Locks de scrape stale liberados automaticamente: ${updated.count}.`);
      }
    } catch (error) {
      this.logger.error(
        `Falha ao liberar locks stale: ${error instanceof Error ? error.message : "erro desconhecido"}`,
      );
    }
  }

  private extractWarningTexts(input: Prisma.JsonValue | null | undefined): string[] {
    if (!Array.isArray(input)) {
      return [];
    }
    return input.map((item) => String(item ?? "").trim()).filter(Boolean);
  }

  private shouldRecoverRun(input: { status: ScrapeStatus; warnings: string[]; extractionStats: Prisma.JsonValue }): boolean {
    if (input.status === "ERROR") {
      return true;
    }

    if (input.warnings.some((warning) => isOperationalRecoveryWarning(warning))) {
      return true;
    }

    const extraction = (input.extractionStats ?? {}) as Prisma.JsonObject;
    const conformance = (extraction.conformanceAudit ?? {}) as Prisma.JsonObject;
    const matchMismatches = Number(conformance.matchMismatches ?? 0);
    const registrationMismatches = Number(conformance.registrationMismatches ?? 0);
    const pendingConflicts = Number(conformance.pendingConflicts ?? 0);

    return matchMismatches > 0 || registrationMismatches > 0 || pendingConflicts > 0;
  }

  private async recoverDegradedScrapes(): Promise<void> {
    const lookbackCutoff = new Date(Date.now() - this.scrapeLookbackMs);
    const runs = await this.prismaRead.scrapeRun.findMany({
      where: {
        startedAt: { gte: lookbackCutoff },
        status: { in: ["PARTIAL", "ERROR"] },
      },
      orderBy: [{ startedAt: "desc" }],
      select: {
        id: true,
        eventId: true,
        status: true,
        startedAt: true,
        warnings: true,
        extractionStats: true,
      },
      take: 200,
    });

    const latestByEventId = new Map<number, (typeof runs)[number]>();
    for (const run of runs) {
      if (!latestByEventId.has(run.eventId)) {
        latestByEventId.set(run.eventId, run);
      }
    }

    let recovered = 0;
    for (const [eventId, run] of latestByEventId.entries()) {
      if (recovered >= this.recoveryMaxEventsPerCycle) {
        break;
      }

      const event = await this.prismaRead.event.findUnique({
        where: { id: eventId },
        select: {
          id: true,
          concluido: true,
          inicioInscricoes: true,
          fimInscricoes: true,
          inicioRealizacao: true,
          fimRealizacao: true,
          dataInicio: true,
          dataFim: true,
        },
      });
      if (!event) {
        continue;
      }
      if (event.concluido) {
        continue;
      }
      const eventSituation = computeEventSituation({
        inicioInscricoes: event.inicioInscricoes,
        fimInscricoes: event.fimInscricoes,
        inicioRealizacao: event.inicioRealizacao,
        fimRealizacao: event.fimRealizacao,
        dataInicio: event.dataInicio,
        dataFim: event.dataFim,
      });
      const policy = buildEventScrapePolicy(event, {
        intervalBySituationMs: this.scrapeIntervalBySituationMs,
      });
      if (!policy.autoSchedule) {
        continue;
      }

      const warnings = this.extractWarningTexts(run.warnings);
      if (!this.shouldRecoverRun({ status: run.status, warnings, extractionStats: run.extractionStats })) {
        continue;
      }

      const lastRecoveryAt = this.lastRecoveryByEventId.get(eventId) ?? 0;
      if (Date.now() - lastRecoveryAt < this.recoveryCooldownMs) {
        continue;
      }
      if (!this.canAttemptRecovery(eventId)) {
        continue;
      }

      const hasPending = await this.queueService.hasPendingScrapeJobForEvent(eventId);
      if (hasPending) {
        continue;
      }
      const recentRuns = await this.prismaRead.scrapeRun.findMany({
        where: { eventId },
        orderBy: [{ startedAt: "desc" }, { id: "desc" }],
        select: {
          status: true,
          warnings: true,
          extractionStats: true,
        },
        take: 3,
      });
      let consecutiveDegraded = 0;
      for (const recentRun of recentRuns) {
        const recentWarnings = this.extractWarningTexts(recentRun.warnings);
        if (
          this.shouldRecoverRun({
            status: recentRun.status,
            warnings: recentWarnings,
            extractionStats: recentRun.extractionStats,
          })
        ) {
          consecutiveDegraded += 1;
          continue;
        }
        break;
      }
      const shouldEscalateToStage2 =
        consecutiveDegraded >= this.recoveryEscalateAfterConsecutiveDegraded &&
        shouldClearCompetitiveDataOnManualStage2(eventSituation);

      const warningText = warnings.join("\n").toLowerCase();
      const shouldPrioritizePostReprocess =
        warningText.includes("conflito_de_atleta_pendente") ||
        warningText.includes("auditoria_conflitos_pendentes");
      if (shouldEscalateToStage2) {
        await this.queueService.enqueueScrapeNow(eventId, 2);
      } else if (shouldPrioritizePostReprocess) {
        await this.queueService.enqueuePostScrapeReprocess(eventId);
      } else {
        await this.queueService.enqueueScrapeNow(eventId, 3);
      }
      this.lastRecoveryByEventId.set(eventId, Date.now());
      this.registerRecoveryAttempt(eventId);
      recovered += 1;
      this.logger.warn(
        `Autorecuperacao acionada para evento ${eventId} (run #${run.id}, status=${run.status}) via ${
          shouldEscalateToStage2
            ? `stage 2 (escalado apos ${consecutiveDegraded} run(s) degradados)`
            : shouldPrioritizePostReprocess
              ? "post-scrape-reprocess"
              : "stage 3"
        }.`,
      );
    }
  }

  private canAttemptRecovery(eventId: number): boolean {
    const now = Date.now();
    const current = this.recoveryAttemptsByEventId.get(eventId);
    if (!current || now - current.startedAt > this.recoveryAttemptWindowMs) {
      this.recoveryAttemptsByEventId.set(eventId, { count: 0, startedAt: now });
      return true;
    }
    if (current.count >= this.recoveryMaxAttemptsPerEvent) {
      this.logger.error(
        `Autorecuperacao pausada para evento ${eventId}: limite de ${this.recoveryMaxAttemptsPerEvent} tentativa(s) em ${Math.round(
          this.recoveryAttemptWindowMs / 60000,
        )}min.`,
      );
      return false;
    }
    return true;
  }

  private registerRecoveryAttempt(eventId: number): void {
    const now = Date.now();
    const current = this.recoveryAttemptsByEventId.get(eventId);
    if (!current || now - current.startedAt > this.recoveryAttemptWindowMs) {
      this.recoveryAttemptsByEventId.set(eventId, { count: 1, startedAt: now });
      return;
    }
    this.recoveryAttemptsByEventId.set(eventId, {
      count: current.count + 1,
      startedAt: current.startedAt,
    });
  }

  private async recoverStaleEventData(): Promise<void> {
    const now = new Date();
    const events = await this.prismaRead.event.findMany({
      where: {
        concluido: false,
      },
      select: {
        id: true,
        lastScrapeAt: true,
        inicioInscricoes: true,
        fimInscricoes: true,
        inicioRealizacao: true,
        fimRealizacao: true,
        dataInicio: true,
        dataFim: true,
      },
    });

    let enqueued = 0;
    for (const event of events) {
      if (enqueued >= this.recoveryMaxEventsPerCycle) {
        break;
      }
      const policy = buildEventScrapePolicy(event, {
        now,
        intervalBySituationMs: this.scrapeIntervalBySituationMs,
      });
      if (!policy.autoSchedule) {
        continue;
      }
      const maxStalenessMs = computeEventRecoveryStaleThresholdMs(policy);
      const stale =
        !event.lastScrapeAt || now.getTime() - event.lastScrapeAt.getTime() > maxStalenessMs;
      if (!stale) {
        continue;
      }
      const lastRecoveryAt = this.lastRecoveryByEventId.get(event.id) ?? 0;
      if (Date.now() - lastRecoveryAt < this.recoveryCooldownMs) {
        continue;
      }
      if (!this.canAttemptRecovery(event.id)) {
        continue;
      }
      const hasPending = await this.queueService.hasPendingScrapeJobForEvent(event.id);
      if (hasPending) {
        continue;
      }
      await this.queueService.enqueueScrape(event.id, "auto-recovery:stale-data");
      this.lastRecoveryByEventId.set(event.id, Date.now());
      this.registerRecoveryAttempt(event.id);
      enqueued += 1;
      this.logger.warn(`Autorecuperacao por stale data acionada para evento ${event.id}.`);
    }
  }
}
