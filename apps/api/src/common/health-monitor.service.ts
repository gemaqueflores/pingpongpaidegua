import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma, ScrapeStatus } from "@prisma/client";
import { PrismaReadService, PrismaService } from "./prisma.service";
import { QueueService } from "./queue.service";

@Injectable()
export class HealthMonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HealthMonitorService.name);
  private timer: NodeJS.Timeout | null = null;
  private readonly enabled = process.env.HEALTH_MONITOR_ENABLED !== "false";
  private readonly intervalMs = Math.max(5000, Number(process.env.HEALTH_MONITOR_INTERVAL_MS ?? "30000"));
  private readonly recoveryEnabled = process.env.HEALTH_MONITOR_RECOVERY_ENABLED !== "false";
  private readonly staleLockMs = Math.max(60000, Number(process.env.HEALTH_MONITOR_STALE_LOCK_MS ?? "900000"));
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
  private readonly lastRecoveryByEventId = new Map<number, number>();

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
    await this.checkDatabase();
    await this.checkQueueAndRecover();
    if (this.recoveryEnabled) {
      await this.recoverStaleLocks();
      await this.recoverDegradedScrapes();
    }
  }

  private async checkDatabase(): Promise<void> {
    try {
      await this.prismaRead.$queryRawUnsafe("SELECT 1");
    } catch (error) {
      this.logger.error(
        `Healthcheck de banco falhou: ${error instanceof Error ? error.message : "erro desconhecido"}`,
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

    const warningText = input.warnings.join("\n").toLowerCase();
    if (
      warningText.includes("http_degraded_results") ||
      warningText.includes("auditoria_partidas_divergencia") ||
      warningText.includes("auditoria_inscricoes_divergencia") ||
      warningText.includes("auditoria_conflitos_pendentes") ||
      warningText.includes("scrape_strict_quality_gate_alerta") ||
      warningText.includes("conflito_de_atleta_pendente")
    ) {
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

      const warnings = this.extractWarningTexts(run.warnings);
      if (!this.shouldRecoverRun({ status: run.status, warnings, extractionStats: run.extractionStats })) {
        continue;
      }

      const lastRecoveryAt = this.lastRecoveryByEventId.get(eventId) ?? 0;
      if (Date.now() - lastRecoveryAt < this.recoveryCooldownMs) {
        continue;
      }

      const hasPending = await this.queueService.hasPendingScrapeJobForEvent(eventId);
      if (hasPending) {
        continue;
      }

      await this.queueService.enqueueScrapeNow(eventId, 3);
      this.lastRecoveryByEventId.set(eventId, Date.now());
      recovered += 1;
      this.logger.warn(
        `Autorecuperacao acionada para evento ${eventId} (run #${run.id}, status=${run.status}) via stage 3.`,
      );
    }
  }
}
