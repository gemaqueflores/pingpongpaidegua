import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { isOperationalRecoveryWarning, resolveScrapeLockStaleMsFromEnv } from "@cbtm/shared";
import { PrismaService } from "../common/prisma.service";
import { QueueService } from "../common/queue.service";
import { computeEventSituation, getEventSituationTransition, normalizeText } from "@cbtm/shared";
import { CreateAdminEventDto } from "./dto/create-admin-event.dto";
import { UpdateAdminEventDto } from "./dto/update-admin-event.dto";
import { CreateEventMergeDto } from "./dto/create-event-merge.dto";
import { RawCaptureRetentionService } from "./raw-capture-retention.service";
import { UserService } from "../user/user.service";

type DateBoundary = "start" | "end";
const EVENT_TZ_OFFSET_MINUTES = -3 * 60;
const DEFAULT_EFFICIENCY_CONFIG = {
  pesoOuro: 130,
  pesoPrata: 80,
  pesoBronze: 50,
} as const;

type EfficiencyConfigVersionRecord = {
  id: number;
  dataInicioVigencia: Date;
  dataFimVigencia: Date | null;
  pesoOuro: number;
  pesoPrata: number;
  pesoBronze: number;
};

type EfficiencyConfigVersionDelegate = {
  findFirst(args: unknown): Promise<EfficiencyConfigVersionRecord | null>;
  update(args: { where: { id: number }; data: { dataFimVigencia: Date } }): Promise<EfficiencyConfigVersionRecord>;
  create(args: {
    data: {
      dataInicioVigencia: Date;
      dataFimVigencia: Date | null;
      pesoOuro: number;
      pesoPrata: number;
      pesoBronze: number;
    };
  }): Promise<EfficiencyConfigVersionRecord>;
};

type PrismaWithEfficiencyVersion = {
  efficiencyConfigVersion?: EfficiencyConfigVersionDelegate;
};

type ConformanceAuditSummary = {
  categoryCountExpected: number;
  categoryCountObserved: number;
  expectedRegistrationsTotal: number;
  observedRegistrationsTotal: number;
  expectedMatchesTotal: number;
  observedMatchesTotal: number;
  expectedPlayedMatchesTotal: number;
  observedPlayedMatchesTotal: number;
  observedWalkoverMatchesTotal: number;
  pendingConflicts: number;
  eliminatoriaMatchesObserved: number;
  athleteCategoryRuleViolations: number;
  registrationMismatches: number;
  matchMismatches: number;
  playedMatchMismatches: number;
  samples: string[];
};

type AuditRunPayload = {
  runId: number;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  warningsCount: number;
  conformanceAudit: ConformanceAuditSummary | null;
};

@Injectable()
export class AdminEventsService {
  private readonly staleLockMs = resolveScrapeLockStaleMsFromEnv(process.env);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly rawCaptureRetention: RawCaptureRetentionService,
  ) {}

  async listEvents() {
    const events = await this.prisma.event.findMany({
      orderBy: [{ createdAt: "desc" }],
      include: {
        _count: {
          select: {
            scrapeRuns: true,
            athletes: true,
            categories: true,
            matches: true,
            athleteMatchConflicts: true,
          },
        },
      },
    });

    const eventIds = events.map((event) => event.id);
    const [publishedMatchesByEvent, publishedResultsByEvent] = eventIds.length
      ? await Promise.all([
          this.prisma.match.groupBy({
            by: ["eventId"],
            where: {
              eventId: { in: eventIds },
              phase: { in: ["GRUPOS", "RESULTADOS"] },
            },
            _count: { _all: true },
          }),
          this.prisma.match.groupBy({
            by: ["eventId"],
            where: {
              eventId: { in: eventIds },
              phase: { in: ["GRUPOS", "RESULTADOS"] },
              OR: [{ winnerIndex: { not: null } }, { p1Sets: { not: null } }, { p2Sets: { not: null } }],
            },
            _count: { _all: true },
          }),
        ])
      : [[], []];

    const publishedMatchesMap = new Map<number, boolean>();
    for (const row of publishedMatchesByEvent) {
      publishedMatchesMap.set(row.eventId, row._count._all > 0);
    }
    const publishedResultsMap = new Map<number, boolean>();
    for (const row of publishedResultsByEvent) {
      publishedResultsMap.set(row.eventId, row._count._all > 0);
    }

    return events.map((event) => ({
      ...event,
      situacaoComputada: computeEventSituation({
        ...event,
        hasPublishedMatches: publishedMatchesMap.get(event.id) ?? false,
        hasPublishedResults: publishedResultsMap.get(event.id) ?? false,
      }),
      proximaMudanca: getEventSituationTransition(event),
    }));
  }

  async createEvent(dto: CreateAdminEventDto) {
    const concluido = dto.concluido ?? false;
    const inicioInscricoes = this.parseDateInput(dto.inicioInscricoes, "inicioInscricoes", "start");
    const fimInscricoes = this.parseDateInput(dto.fimInscricoes, "fimInscricoes", "end");
    const inicioRealizacao = this.resolveDateField(
      dto.inicioRealizacao,
      dto.dataInicio,
      "inicioRealizacao",
      "start",
    );
    const fimRealizacao = this.resolveDateField(dto.fimRealizacao, dto.dataFim, "fimRealizacao", "end");

    this.validateEventDateRules({
      concluido,
      inicioInscricoes,
      fimInscricoes,
      inicioRealizacao,
      fimRealizacao,
    });
    this.validateCircularRulesConfig({
      groupBestOfSets: dto.groupBestOfSets,
      eliminationBestOfSets: dto.eliminationBestOfSets,
    });

    const event = await this.prisma.event.create({
      data: {
        cbtmEventId: dto.cbtmEventId,
        nome: dto.nome,
        nivel: dto.nivel ?? null,
        ratingMatchFormat: dto.ratingMatchFormat ?? "RR_K1",
        competitionFormat: dto.competitionFormat ?? "AUTO",
        seedCriteria: dto.seedCriteria ?? "AUTO",
        groupBestOfSets: dto.groupBestOfSets ?? null,
        eliminationBestOfSets: dto.eliminationBestOfSets ?? null,
        allowCobraAdjustments: dto.allowCobraAdjustments ?? true,
        allowByes: dto.allowByes ?? true,
        inicioInscricoes,
        fimInscricoes,
        inicioRealizacao,
        fimRealizacao,
        dataInicio: inicioRealizacao,
        dataFim: fimRealizacao,
        concluido,
      },
    });

    await this.invalidateReadModelCaches(event.id);

    if (event.concluido) {
      await this.queue.enqueueScrapeNow(event.id);
    } else {
      await this.queue.enqueueScrape(event.id, "admin-create");
    }

    return event;
  }

  async getEfficiencyConfig() {
    const versionDelegate = (this.prisma as unknown as PrismaWithEfficiencyVersion).efficiencyConfigVersion;
    const currentVersion = await versionDelegate?.findFirst({
      where: { dataFimVigencia: null },
      orderBy: { dataInicioVigencia: "desc" },
    });

    if (currentVersion) {
      return currentVersion;
    }

    const legacyConfig = await this.prisma.efficiencyConfig.findUnique({
      where: { id: 1 },
    });

    const seedConfig = legacyConfig ?? DEFAULT_EFFICIENCY_CONFIG;

    if (versionDelegate) {
      return versionDelegate.create({
        data: {
          dataInicioVigencia: new Date(),
          dataFimVigencia: null,
          pesoOuro: seedConfig.pesoOuro,
          pesoPrata: seedConfig.pesoPrata,
          pesoBronze: seedConfig.pesoBronze,
        },
      });
    }

    return this.prisma.efficiencyConfig.create({
      data: {
        id: 1,
        ...seedConfig,
      },
    });
  }

  async updateEfficiencyConfig(input: { pesoOuro: number; pesoPrata: number; pesoBronze: number }) {
    const prismaWithTransaction = this.prisma as unknown as {
      $transaction<T>(callback: (client: PrismaWithEfficiencyVersion) => Promise<T>): Promise<T>;
    };

    const saved = await prismaWithTransaction.$transaction(async (client) => {
      const versionDelegate = client.efficiencyConfigVersion;
      if (!versionDelegate) {
        return this.prisma.efficiencyConfig.upsert({
          where: { id: 1 },
          create: {
            id: 1,
            pesoOuro: input.pesoOuro,
            pesoPrata: input.pesoPrata,
            pesoBronze: input.pesoBronze,
          },
          update: {
            pesoOuro: input.pesoOuro,
            pesoPrata: input.pesoPrata,
            pesoBronze: input.pesoBronze,
          },
        });
      }

      const effectiveStart = new Date();
      const previousEnd = new Date(effectiveStart.getTime() - 1);
      const currentVersion = await versionDelegate.findFirst({
        where: { dataFimVigencia: null },
        orderBy: { dataInicioVigencia: "desc" },
      });

      if (currentVersion) {
        await versionDelegate.update({
          where: { id: currentVersion.id },
          data: { dataFimVigencia: previousEnd },
        });
      }

      return versionDelegate.create({
        data: {
          dataInicioVigencia: effectiveStart,
          dataFimVigencia: null,
          pesoOuro: input.pesoOuro,
          pesoPrata: input.pesoPrata,
          pesoBronze: input.pesoBronze,
        },
      });
    });
    UserService.invalidateEfficiencyMemoryCaches();
    return saved;
  }

  async listEventMerges() {
    return this.prisma.eventMerge.findMany({
      orderBy: [{ primaryEventId: "asc" }, { secondaryEventId: "asc" }],
      include: {
        primaryEvent: {
          select: {
            id: true,
            cbtmEventId: true,
            nome: true,
          },
        },
        secondaryEvent: {
          select: {
            id: true,
            cbtmEventId: true,
            nome: true,
          },
        },
      },
    });
  }

  async createEventMerge(input: CreateEventMergeDto) {
    if (input.primaryEventId === input.secondaryEventId) {
      throw new BadRequestException("Evento principal e especial devem ser diferentes.");
    }

    const [primary, secondary] = await Promise.all([
      this.prisma.event.findUnique({ where: { id: input.primaryEventId }, select: { id: true } }),
      this.prisma.event.findUnique({
        where: { id: input.secondaryEventId },
        select: { id: true, nome: true },
      }),
    ]);

    if (!primary) {
      throw new NotFoundException("Evento principal nao encontrado.");
    }
    if (!secondary) {
      throw new NotFoundException("Evento especial nao encontrado.");
    }

    const suffix = this.resolveMergeCategorySuffix(input.categorySuffix, secondary.nome);

    const linkAsSecondary = await this.prisma.eventMerge.findFirst({
      where: {
        primaryEventId: input.secondaryEventId,
      },
      select: { id: true },
    });
    if (linkAsSecondary) {
      throw new BadRequestException("Evento especial nao pode ser principal de outro vinculo.");
    }

    return this.prisma.eventMerge.upsert({
      where: {
        secondaryEventId: input.secondaryEventId,
      },
      create: {
        primaryEventId: input.primaryEventId,
        secondaryEventId: input.secondaryEventId,
        categorySuffix: suffix,
      },
      update: {
        primaryEventId: input.primaryEventId,
        categorySuffix: suffix,
      },
      include: {
        primaryEvent: {
          select: {
            id: true,
            cbtmEventId: true,
            nome: true,
          },
        },
        secondaryEvent: {
          select: {
            id: true,
            cbtmEventId: true,
            nome: true,
          },
        },
      },
    });
  }

  async deleteEventMerge(mergeId: number) {
    await this.prisma.eventMerge.delete({
      where: { id: mergeId },
    });
    return { success: true };
  }

  private resolveMergeCategorySuffix(inputSuffix: string | undefined, secondaryEventName: string | null): string {
    const normalizedInput = String(inputSuffix ?? "").trim();
    if (normalizedInput) {
      return normalizedInput.startsWith("-") ? ` ${normalizedInput}` : normalizedInput;
    }

    const eventName = normalizeText(String(secondaryEventName ?? ""));
    if (eventName.includes("dupla mista")) {
      return " - DUPLAS MISTAS";
    }
    if (eventName.includes("dupla")) {
      return " - DUPLAS";
    }
    return " -X";
  }

  async updateEvent(id: number, dto: UpdateAdminEventDto) {
    const currentEvent = await this.ensureEvent(id);

    const hasInicioInscricoes = this.hasOwn(dto, "inicioInscricoes");
    const hasFimInscricoes = this.hasOwn(dto, "fimInscricoes");
    const hasInicioRealizacao = this.hasOwn(dto, "inicioRealizacao");
    const hasFimRealizacao = this.hasOwn(dto, "fimRealizacao");
    const hasDataInicio = this.hasOwn(dto, "dataInicio");
    const hasDataFim = this.hasOwn(dto, "dataFim");

    const nextConcluido = this.hasOwn(dto, "concluido")
      ? Boolean(dto.concluido)
      : currentEvent.concluido;

    const nextInicioInscricoes = hasInicioInscricoes
      ? this.parseDateInput(dto.inicioInscricoes, "inicioInscricoes", "start")
      : currentEvent.inicioInscricoes;
    const nextFimInscricoes = hasFimInscricoes
      ? this.parseDateInput(dto.fimInscricoes, "fimInscricoes", "end")
      : currentEvent.fimInscricoes;

    const nextInicioRealizacao = hasInicioRealizacao
      ? this.parseDateInput(dto.inicioRealizacao, "inicioRealizacao", "start")
      : hasDataInicio
        ? this.parseDateInput(dto.dataInicio, "dataInicio", "start")
        : currentEvent.inicioRealizacao ?? currentEvent.dataInicio;
    const nextFimRealizacao = hasFimRealizacao
      ? this.parseDateInput(dto.fimRealizacao, "fimRealizacao", "end")
      : hasDataFim
        ? this.parseDateInput(dto.dataFim, "dataFim", "end")
        : currentEvent.fimRealizacao ?? currentEvent.dataFim;

    this.validateEventDateRules({
      concluido: nextConcluido,
      inicioInscricoes: nextInicioInscricoes,
      fimInscricoes: nextFimInscricoes,
      inicioRealizacao: nextInicioRealizacao,
      fimRealizacao: nextFimRealizacao,
    });
    this.validateCircularRulesConfig({
      groupBestOfSets: dto.groupBestOfSets,
      eliminationBestOfSets: dto.eliminationBestOfSets,
    });

    const event = await this.prisma.event.update({
      where: { id },
      data: {
        cbtmEventId: dto.cbtmEventId,
        nome: dto.nome,
        nivel: dto.nivel,
        ratingMatchFormat: dto.ratingMatchFormat,
        competitionFormat: dto.competitionFormat,
        seedCriteria: dto.seedCriteria,
        groupBestOfSets: dto.groupBestOfSets,
        eliminationBestOfSets: dto.eliminationBestOfSets,
        allowCobraAdjustments: dto.allowCobraAdjustments,
        allowByes: dto.allowByes,
        inicioInscricoes: nextInicioInscricoes,
        fimInscricoes: nextFimInscricoes,
        inicioRealizacao: nextInicioRealizacao,
        fimRealizacao: nextFimRealizacao,
        dataInicio: nextInicioRealizacao,
        dataFim: nextFimRealizacao,
        concluido: nextConcluido,
      },
    });

    await this.invalidateReadModelCaches(event.id);

    if (!event.concluido) {
      await this.queue.enqueueScrape(event.id, "admin-update");
    } else if (!currentEvent.concluido && event.concluido) {
      await this.queue.enqueueScrapeNow(event.id);
    }

    return event;
  }

  async deleteEvent(id: number) {
    await this.ensureEvent(id);

    const deleted = await this.prisma.$transaction(async (tx) => {
      const athletes = await tx.athlete.findMany({
        where: { eventId: id },
        select: { id: true, clubId: true },
      });
      const athleteIds = athletes.map((item) => item.id);
      const clubIds = [...new Set(athletes.map((item) => item.clubId))];

      const matches = await tx.match.findMany({
        where: { eventId: id },
        select: { id: true },
      });
      const matchIds = matches.map((item) => item.id);

      const categories = await tx.category.findMany({
        where: { eventId: id },
        select: { id: true },
      });
      const categoryIds = categories.map((item) => item.id);

      const deletedMatchParticipants =
        matchIds.length === 0
          ? { count: 0 }
          : await tx.matchParticipant.deleteMany({
              where: {
                matchId: { in: matchIds },
              },
            });

      const deletedAthleteCategories =
        athleteIds.length === 0 || categoryIds.length === 0
          ? { count: 0 }
          : await tx.athleteCategory.deleteMany({
              where: {
                OR: [
                  { athleteId: { in: athleteIds } },
                  { categoryId: { in: categoryIds } },
                ],
              },
            });

      const deletedAliases =
        athleteIds.length === 0
          ? { count: 0 }
          : await tx.athleteAlias.deleteMany({
              where: {
                athleteId: { in: athleteIds },
              },
            });

      const deletedConflicts = await tx.athleteMatchConflict.deleteMany({
        where: { eventId: id },
      });

      const deletedMatches = await tx.match.deleteMany({
        where: { eventId: id },
      });

      const deletedAthletes = await tx.athlete.deleteMany({
        where: { eventId: id },
      });

      const deletedCategories = await tx.category.deleteMany({
        where: { eventId: id },
      });

      const deletedRawCaptures = await tx.rawCapture.deleteMany({
        where: { eventId: id },
      });

      const deletedScrapeRuns = await tx.scrapeRun.deleteMany({
        where: { eventId: id },
      });

      await tx.event.delete({
        where: { id },
      });

      if (clubIds.length > 0) {
        await tx.club.deleteMany({
          where: {
            id: { in: clubIds },
            athletes: { none: {} },
          },
        });
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
        scrapeRuns: deletedScrapeRuns.count,
      };
    });

    return {
      success: true,
      deleted,
    };
  }

  async markCompleted(id: number) {
    await this.ensureEvent(id);

    const event = await this.prisma.event.update({
      where: { id },
      data: {
        concluido: true,
      },
    });

    await this.invalidateReadModelCaches(event.id);
    return event;
  }

  async scrapeNow(id: number, stage?: 1 | 2 | 3) {
    const event = await this.ensureEvent(id);

    if (event.scrapeLockedAt) {
      const lockAgeMs = Date.now() - event.scrapeLockedAt.getTime();
      if (lockAgeMs < this.staleLockMs) {
        return {
          status: "busy",
          eventId: id,
          stage: stage ?? null,
          lockedAt: event.scrapeLockedAt.toISOString(),
          message: "Já existe um scrape em execução para este evento.",
        } as const;
      }

      // Lock órfão (ex.: restart do worker): libera para não bloquear o admin indefinidamente.
      await this.prisma.event.update({
        where: { id },
        data: {
          scrapeLockedAt: null,
        },
      });
    }

    return this.queue.enqueueScrapeNow(id, stage);
  }

  async reprocessPostScrape(id: number) {
    await this.ensureEvent(id);
    return this.queue.enqueuePostScrapeReprocess(id);
  }

  async reprocessLifecycle(id: number) {
    const event = await this.ensureEvent(id);

    if (event.scrapeLockedAt) {
      const lockAgeMs = Date.now() - event.scrapeLockedAt.getTime();
      if (lockAgeMs < this.staleLockMs) {
        return {
          status: "busy",
          eventId: id,
          lockedAt: event.scrapeLockedAt.toISOString(),
          message: "Já existe um scrape em execução para este evento.",
        } as const;
      }

      await this.prisma.event.update({
        where: { id },
        data: { scrapeLockedAt: null },
      });
    }

    return this.queue.enqueueReprocessLifecycle(id);
  }

  async listScrapeRuns(eventId: number) {
    await this.ensureEvent(eventId);

    return this.prisma.scrapeRun.findMany({
      where: { eventId },
      orderBy: [{ startedAt: "desc" }],
      take: 5,
    });
  }

  async getLatestAudit(eventId: number) {
    await this.ensureEvent(eventId);

    const run = await this.prisma.scrapeRun.findFirst({
      where: { eventId },
      orderBy: [{ startedAt: "desc" }],
      select: {
        id: true,
        startedAt: true,
        finishedAt: true,
        status: true,
        warnings: true,
        extractionStats: true,
      },
    });

    if (!run) {
      return {
        eventId,
        hasAudit: false,
        message: "Nenhum scrape_run encontrado para este evento.",
      };
    }

    return {
      eventId,
      hasAudit: true,
      run: this.mapRunToAuditPayload(run),
    };
  }

  async getAuditHistory(eventId: number) {
    await this.ensureEvent(eventId);

    const runs = await this.prisma.scrapeRun.findMany({
      where: { eventId },
      orderBy: [{ startedAt: "desc" }],
      take: 20,
      select: {
        id: true,
        startedAt: true,
        finishedAt: true,
        status: true,
        warnings: true,
        extractionStats: true,
      },
    });

    return {
      eventId,
      count: runs.length,
      items: runs.map((run) => this.mapRunToAuditPayload(run)),
    };
  }

  async cleanupRawCaptures(input: {
    eventId?: number;
    dryRun?: boolean;
    errorDaysOverride?: number;
  }) {
    if (input.eventId) {
      await this.ensureEvent(input.eventId);
    }
    return this.rawCaptureRetention.cleanup(input);
  }

  async listAthleteConflicts(eventId: number) {
    await this.ensureEvent(eventId);

    return this.prisma.athleteMatchConflict.findMany({
      where: { eventId },
      orderBy: [{ createdAt: "desc" }],
      include: {
        resolvedAthlete: {
          select: {
            id: true,
            nameDisplay: true,
          },
        },
      },
      take: 200,
    });
  }

  async resolveAthleteConflict(eventId: number, conflictId: number, athleteId: number) {
    await this.ensureEvent(eventId);

    const conflict = await this.prisma.athleteMatchConflict.findFirst({
      where: {
        id: conflictId,
        eventId,
      },
    });

    if (!conflict) {
      throw new NotFoundException("Conflito não encontrado");
    }

    const athlete = await this.prisma.athlete.findFirst({
      where: {
        id: athleteId,
        eventId,
      },
    });

    if (!athlete) {
      throw new BadRequestException("Atleta inválido para este evento");
    }

    const payload = conflict.candidateAthletes as {
      matchKey?: string;
      placeholderAthleteId?: number | null;
    };

    await this.prisma.$transaction(async (tx) => {
      if (payload?.matchKey && payload?.placeholderAthleteId) {
        const match = await tx.match.findFirst({
          where: {
            eventId,
            matchKey: payload.matchKey,
          },
          select: {
            id: true,
          },
        });

        if (match) {
          await tx.matchParticipant.deleteMany({
            where: {
              matchId: match.id,
              athleteId: payload.placeholderAthleteId,
            },
          });

          await tx.matchParticipant.upsert({
            where: {
              matchId_athleteId: {
                matchId: match.id,
                athleteId,
              },
            },
            update: {},
            create: {
              matchId: match.id,
              athleteId,
            },
          });
        }
      }

      await tx.athleteAlias.upsert({
        where: {
          athleteId_aliasNormalized: {
            athleteId,
            aliasNormalized: normalizeText(conflict.shortName),
          },
        },
        update: {
          aliasDisplay: conflict.shortName,
        },
        create: {
          athleteId,
          aliasDisplay: conflict.shortName,
          aliasNormalized: normalizeText(conflict.shortName),
          source: "JOGOS",
        },
      });

      await tx.athleteMatchConflict.update({
        where: {
          id: conflict.id,
        },
        data: {
          resolvedAthleteId: athleteId,
          resolvedAt: new Date(),
        },
      });
    });

    return {
      success: true,
      conflictId,
      athleteId,
    };
  }

  private mapRunToAuditPayload(input: {
    id: number;
    startedAt: Date;
    finishedAt: Date | null;
    status: string;
    warnings: Prisma.JsonValue;
    extractionStats: Prisma.JsonValue;
  }): AuditRunPayload {
    const warningsCount = Array.isArray(input.warnings)
      ? input.warnings.filter((warning) => isOperationalRecoveryWarning(String(warning ?? ""))).length
      : 0;
    return {
      runId: input.id,
      startedAt: input.startedAt.toISOString(),
      finishedAt: input.finishedAt ? input.finishedAt.toISOString() : null,
      status: input.status,
      warningsCount,
      conformanceAudit: this.extractConformanceAudit(input.extractionStats),
    };
  }

  private extractConformanceAudit(input: Prisma.JsonValue): ConformanceAuditSummary | null {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return null;
    }

    const json = input as Prisma.JsonObject;
    const auditRaw = json.conformanceAudit;
    if (!auditRaw || typeof auditRaw !== "object" || Array.isArray(auditRaw)) {
      return null;
    }

    const audit = auditRaw as Prisma.JsonObject;
    const numberOrZero = (value: Prisma.JsonValue | undefined): number =>
      typeof value === "number" && Number.isFinite(value) ? value : 0;
    const samples = Array.isArray(audit.samples)
      ? audit.samples.filter((item): item is string => typeof item === "string")
      : [];

    return {
      categoryCountExpected: numberOrZero(audit.categoryCountExpected),
      categoryCountObserved: numberOrZero(audit.categoryCountObserved),
      expectedRegistrationsTotal: numberOrZero(audit.expectedRegistrationsTotal),
      observedRegistrationsTotal: numberOrZero(audit.observedRegistrationsTotal),
      expectedMatchesTotal: numberOrZero(audit.expectedMatchesTotal),
      observedMatchesTotal: numberOrZero(audit.observedMatchesTotal),
      expectedPlayedMatchesTotal: numberOrZero(audit.expectedPlayedMatchesTotal),
      observedPlayedMatchesTotal: numberOrZero(audit.observedPlayedMatchesTotal),
      observedWalkoverMatchesTotal: numberOrZero(audit.observedWalkoverMatchesTotal),
      pendingConflicts: numberOrZero(audit.pendingConflicts),
      eliminatoriaMatchesObserved: numberOrZero(audit.eliminatoriaMatchesObserved),
      athleteCategoryRuleViolations: numberOrZero(audit.athleteCategoryRuleViolations),
      registrationMismatches: numberOrZero(audit.registrationMismatches),
      matchMismatches: numberOrZero(audit.matchMismatches),
      playedMatchMismatches: numberOrZero(audit.playedMatchMismatches),
      samples,
    };
  }

  private async ensureEvent(eventId: number) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) {
      throw new NotFoundException("Evento não encontrado");
    }
    return event;
  }

  private hasOwn<T extends object>(obj: T, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  private parseDateInput(
    rawValue: string | null | undefined,
    fieldName: string,
    boundary: DateBoundary,
  ): Date | null {
    const value = String(rawValue ?? "").trim();
    if (!value) {
      return null;
    }

    const brMatch = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (brMatch) {
      const day = Number(brMatch[1]);
      const month = Number(brMatch[2]);
      const year = Number(brMatch[3]);
      return this.buildUtcDate(year, month, day, boundary, fieldName);
    }

    const isoDateMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoDateMatch) {
      const year = Number(isoDateMatch[1]);
      const month = Number(isoDateMatch[2]);
      const day = Number(isoDateMatch[3]);
      return this.buildUtcDate(year, month, day, boundary, fieldName);
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(
        `Campo '${fieldName}' invalido. Use o formato dd/mm/yyyy.`,
      );
    }

    return parsed;
  }

  private resolveDateField(
    primary: string | null | undefined,
    fallback: string | null | undefined,
    fieldName: string,
    boundary: DateBoundary,
  ): Date | null {
    return (
      this.parseDateInput(primary, fieldName, boundary) ??
      this.parseDateInput(fallback, fieldName, boundary)
    );
  }

  private buildUtcDate(
    year: number,
    month: number,
    day: number,
    boundary: DateBoundary,
    fieldName: string,
  ): Date {
    const calendarValidation = new Date(Date.UTC(year, month - 1, day));
    const isCalendarDateValid =
      calendarValidation.getUTCFullYear() === year &&
      calendarValidation.getUTCMonth() === month - 1 &&
      calendarValidation.getUTCDate() === day;
    if (!isCalendarDateValid) {
      throw new BadRequestException(
        `Campo '${fieldName}' invalido. Use uma data real no formato dd/mm/yyyy.`,
      );
    }

    const hour = boundary === "start" ? 0 : 23;
    const minute = boundary === "start" ? 0 : 59;
    const second = boundary === "start" ? 0 : 59;
    const millisecond = 0;
    // Datas administrativas devem respeitar o fuso do evento (UTC-03),
    // mantendo inicio 00:00:00 e fim 23:59:59 do dia informado.
    const utcMillis =
      Date.UTC(year, month - 1, day, hour, minute, second, millisecond) -
      EVENT_TZ_OFFSET_MINUTES * 60 * 1000;
    const date = new Date(utcMillis);

    return date;
  }

  private validateEventDateRules(input: {
    concluido: boolean;
    inicioInscricoes: Date | null;
    fimInscricoes: Date | null;
    inicioRealizacao: Date | null;
    fimRealizacao: Date | null;
  }): void {
    const missing: string[] = [];

    if (!input.concluido) {
      if (!input.inicioInscricoes) {
        missing.push("inicioInscricoes");
      }
      if (!input.fimInscricoes) {
        missing.push("fimInscricoes");
      }
      if (!input.inicioRealizacao) {
        missing.push("inicioRealizacao");
      }
      if (!input.fimRealizacao) {
        missing.push("fimRealizacao");
      }
    }

    if (missing.length > 0) {
      throw new BadRequestException(
        `Eventos nao concluidos exigem as datas: ${missing.join(", ")} (formato dd/mm/yyyy).`,
      );
    }

    if (input.inicioInscricoes && input.fimInscricoes && input.inicioInscricoes > input.fimInscricoes) {
      throw new BadRequestException("Periodo de inscricoes invalido: inicio maior que fim.");
    }

    if (input.inicioRealizacao && input.fimRealizacao && input.inicioRealizacao > input.fimRealizacao) {
      throw new BadRequestException("Periodo de realizacao invalido: inicio maior que fim.");
    }

    if (input.inicioInscricoes && input.fimRealizacao && input.inicioInscricoes > input.fimRealizacao) {
      throw new BadRequestException("Datas invalidas: inicio de inscricoes apos fim de realizacao.");
    }
  }

  private validateCircularRulesConfig(input: {
    groupBestOfSets?: number | null;
    eliminationBestOfSets?: number | null;
  }) {
    const entries: Array<{ label: string; value: number | null | undefined }> = [
      { label: "groupBestOfSets", value: input.groupBestOfSets },
      { label: "eliminationBestOfSets", value: input.eliminationBestOfSets },
    ];

    for (const entry of entries) {
      if (entry.value === null || entry.value === undefined) {
        continue;
      }
      if (!Number.isInteger(entry.value) || entry.value < 1) {
        throw new BadRequestException(`${entry.label} deve ser inteiro positivo.`);
      }
      if (entry.value % 2 === 0) {
        throw new BadRequestException(`${entry.label} deve ser ímpar conforme regulamento.`);
      }
    }
  }

  private async invalidateReadModelCaches(eventId: number): Promise<void> {
    const relatedEventIds = await this.resolveRelatedEventIdsForCacheInvalidation(eventId);
    await this.prisma.readModelCache.deleteMany({
      where: {
        eventId: { in: relatedEventIds },
      },
    });
  }

  private async resolveRelatedEventIdsForCacheInvalidation(eventId: number): Promise<number[]> {
    const merges = await this.prisma.eventMerge.findMany({
      where: {
        OR: [{ primaryEventId: eventId }, { secondaryEventId: eventId }],
      },
      select: {
        primaryEventId: true,
        secondaryEventId: true,
      },
    });

    const ids = new Set<number>([eventId]);
    for (const merge of merges) {
      ids.add(merge.primaryEventId);
      ids.add(merge.secondaryEventId);
    }
    return [...ids];
  }
}
