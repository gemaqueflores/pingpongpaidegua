import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  EventSituation,
  MatchPerformanceInput,
  SummaryOrderBy,
  calculateAthletePointPerformance,
  computeEventSituation,
  getAthleteMatchOutcome,
  getMatchPhaseOrder,
  getRoundSemanticOrder,
  normalizeAthleteName,
  normalizeText,
  normalizeRegistrationScope,
  type RegistrationScope,
} from "@cbtm/shared";
import { Prisma } from "@prisma/client";
import { PrismaReadService } from "../common/prisma.service";
import {
  computeCategoryClassificationSummaries,
  computeCategoryPerformanceSummaries,
  type CategoryAnalyticsMatch,
} from "./athlete-analytics";
import { buildCareerMedalTable } from "./career-medals";
import {
  canUseGroupSimulation,
  hasGroupStructureFromMatch,
  resolveUserEventStatus,
} from "./event-group-eligibility";
import { simulateGroupsForCategory } from "./group-simulator";
import {
  computeRegistrationBreakdown,
  hasMinimumSimulationAthletes,
  selectAthletesByRegistrationScope,
  type RegistrationBreakdown,
  type SimulationAthleteLink,
} from "./group-simulation-scope";

const IGNORED_CATEGORY_IDS = ["88888888", "99999999"];
const SUPPORT_EMAIL = "gemaqueflores@gmail.com";
const DEFAULT_EFFICIENCY_WEIGHTS = {
  pesoOuro: 400,
  pesoPrata: 240,
  pesoBronze: 120,
} as const;

type AthleteSummaryPlayer = {
  id: number | null;
  name: string;
  club: { id: number; name: string } | null;
};

type AthleteSummaryMatch = {
  id: number;
  event: {
    id: number;
    cbtmEventId: number;
    nome: string;
    nivel: "ESTADUAL" | "COPA" | "NACIONAL" | "OPEN" | null;
    dataInicio: Date | null;
    dataFim: Date | null;
    concluido: boolean;
  };
  phase: string;
  round: string | null;
  tableNumber: string | null;
  matchDatetime: Date | null;
  scoreRaw: string;
  scoreFinal: { setsA: number; setsB: number } | null;
  scoreSets: Array<{ set: number; a: number; b: number }>;
  sets: Array<{ p1: number; p2: number }>;
  setsResult: { p1Sets: number; p2Sets: number } | null;
  winnerIndex: 0 | 1 | null;
  athleteIndex: 0 | 1 | null;
  outcome: "W" | "L" | null;
  sourceUrl: string | null;
  players: [AthleteSummaryPlayer | null, AthleteSummaryPlayer | null];
  category: {
    id: number;
    name: string;
    cbtmCategoryId: string | null;
  };
  matchKey: string;
  gameId: string | null;
  athlete: {
    id: number;
    name: string;
  } | null;
  athleteKey: string | null;
  opponent: {
    id: number;
    name: string;
    club: { id: number; name: string } | null;
  } | null;
};

type MatchWithRelations = Prisma.MatchGetPayload<{
  include: {
    event: true;
    category: true;
    participants: {
      include: {
        athlete: {
          include: {
            club: true;
          };
        };
      };
    };
  };
}>;

type MatchMinimalWithRelations = Prisma.MatchGetPayload<{
  include: {
    category: true;
    participants: {
      include: {
        athlete: {
          include: {
            club: true;
          };
        };
      };
    };
  };
}>;

type AthleteDirectoryRow = {
  athleteKey: string;
  nameDisplay: string;
  nameReduced: string;
  firstLetter: string;
  totalEvents: number;
  totalAthleteRecords: number;
};

type ClubEfficiencyRow = {
  clubId: number;
  clubName: string;
  athleteCount: number;
  ouro: number;
  prata: number;
  bronze: number;
  totalQuantidade: number;
  totalPontuacao: number;
  pontuacao: {
    ouro: number;
    prata: number;
    bronze: number;
    total: number;
  };
};

type EfficiencyCompetitionType = "BRASILEIRAO" | "COPA" | "ESTADUAL" | "OPEN";

type EfficiencyMedalCounter = {
  ouro: number;
  prata: number;
  bronze: number;
};

type EfficiencyHistoryMedalist = {
  athleteId: number;
  athleteName: string;
  categoryName: string;
  medalha: "ouro" | "prata" | "bronze";
};

type EventMergeEntry = {
  id: number;
  primaryEventId: number;
  secondaryEventId: number;
  categorySuffix: string;
};

type EventScope = {
  canonicalEventId: number;
  allEventIds: number[];
  childSuffixByEventId: Map<number, string>;
};

function toReducedName(name: string): string {
  const tokens = name
    .trim()
    .split(/\s+/g)
    .filter(Boolean);
  if (tokens.length === 0) {
    return "";
  }
  if (tokens.length === 1) {
    return tokens[0];
  }
  return `${tokens[0]} ${tokens[tokens.length - 1]}`;
}

function toFirstLetter(name: string): string {
  const normalized = normalizeAthleteName(name);
  const first = normalized.charAt(0).toUpperCase();
  if (!first) {
    return "#";
  }
  return /^[A-Z]$/.test(first) ? first : "#";
}

function parseSetsResultFromScoreRaw(scoreRaw: string | null | undefined): { p1Sets: number; p2Sets: number } | null {
  const normalized = String(scoreRaw ?? "").trim();
  if (!normalized) {
    return null;
  }

  const match = normalized.match(/^(\d+)\s*[-xX]\s*(\d+)$/);
  if (!match) {
    return null;
  }

  const p1Sets = Number(match[1]);
  const p2Sets = Number(match[2]);
  if (!Number.isFinite(p1Sets) || !Number.isFinite(p2Sets)) {
    return null;
  }

  return {
    p1Sets,
    p2Sets,
  };
}

function createEmptyEfficiencyMedalCounter(): EfficiencyMedalCounter {
  return { ouro: 0, prata: 0, bronze: 0 };
}

function totalEfficiencyMedals(counter: EfficiencyMedalCounter): number {
  return counter.ouro + counter.prata + counter.bronze;
}

function toEfficiencyCompetitionType(level: "ESTADUAL" | "COPA" | "NACIONAL" | "OPEN" | null): EfficiencyCompetitionType {
  if (level === "OPEN") return "OPEN";
  if (level === "COPA") return "COPA";
  if (level === "ESTADUAL") return "ESTADUAL";
  return "BRASILEIRAO";
}

function sanitizeUserWarnings(warnings: string[]): string[] {
  const blockedPatterns = [
    /inconsist/i,
    /colis/i,
    /conflit/i,
    /duplicad/i,
    /diagnost/i,
    /normalizou/i,
    /vinculo/i,
    /omitid/i,
    /permut/i,
  ];

  return warnings.filter((warning) => {
    const text = String(warning ?? "").trim();
    if (!text) {
      return false;
    }
    return !blockedPatterns.some((pattern) => pattern.test(text));
  });
}

@Injectable()
export class UserService {
  private readonly prisma: PrismaReadService;
  private globalEfficiencyCache:
    | {
        expiresAt: number;
        data: {
          weights: { pesoOuro: number; pesoPrata: number; pesoBronze: number };
          ranking: ClubEfficiencyRow[];
        };
      }
    | null = null;
  private readonly clubEfficiencyCache = new Map<
    number,
    {
      expiresAt: number;
      data: unknown;
    }
  >();
  private eventMergeCache:
    | {
        expiresAt: number;
        entries: EventMergeEntry[];
      }
    | null = null;
  private static readonly EFFICIENCY_CACHE_TTL_MS = 60_000;

  constructor(@Inject(PrismaReadService) prisma: PrismaReadService) {
    this.prisma = prisma;
  }

  async reportProblem(titleRaw: string, descriptionRaw: string): Promise<{ success: true }> {
    const title = String(titleRaw ?? "").trim();
    const description = String(descriptionRaw ?? "").trim();
    if (!title || !description) {
      throw new BadRequestException("Titulo e descricao sao obrigatorios.");
    }

    await this.sendSupportEmail(title, description);
    return { success: true };
  }

  private async sendSupportEmail(title: string, description: string): Promise<void> {
    const smtpHost = process.env.SMTP_HOST?.trim();
    const smtpPort = Number(process.env.SMTP_PORT ?? "587");
    const smtpUser = process.env.SMTP_USER?.trim();
    const smtpPass = process.env.SMTP_PASS?.trim();
    const smtpFrom = process.env.SMTP_FROM?.trim();

    if (!smtpHost || !smtpUser || !smtpPass || !smtpFrom || !Number.isFinite(smtpPort)) {
      throw new BadRequestException(
        "SMTP nao configurado: defina SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS e SMTP_FROM.",
      );
    }

    const moduleName = "nodemailer";
    const nodemailerModule = (await import(moduleName as string)) as {
      createTransport: (config: Record<string, unknown>) => {
        sendMail: (mail: Record<string, unknown>) => Promise<unknown>;
      };
    };

    const transporter = nodemailerModule.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });

    const safeTitle = title.replace(/\r?\n/g, " ").trim();
    const safeDescription = description.replace(/\r\n/g, "\n");
    await transporter.sendMail({
      from: smtpFrom,
      to: SUPPORT_EMAIL,
      subject: `Bug Site: ${safeTitle}`,
      text: safeDescription,
      html: `<p>${safeDescription.replace(/\n/g, "<br/>")}</p>`,
    });
  }

  async listEvents() {
    const [events, merges] = await Promise.all([
      this.prisma.event.findMany({
        orderBy: [{ dataInicio: "desc" }, { nome: "asc" }],
        select: {
          id: true,
          cbtmEventId: true,
          nome: true,
          nivel: true,
          inicioInscricoes: true,
          fimInscricoes: true,
          inicioRealizacao: true,
          fimRealizacao: true,
          dataInicio: true,
          dataFim: true,
          concluido: true,
          lastScrapeAt: true,
        },
      }),
      this.loadEventMerges(),
    ]);

    if (events.length === 0) {
      return [];
    }

    const hiddenSecondaryIds = new Set<number>(merges.map((entry) => entry.secondaryEventId));
    const displayEvents = events.filter((event) => !hiddenSecondaryIds.has(event.id));
    if (displayEvents.length === 0) {
      return [];
    }

    const scopeByEventId = new Map<number, EventScope>();
    for (const event of displayEvents) {
      scopeByEventId.set(event.id, await this.resolveEventScopeByCanonical(event.id));
    }

    const allScopedEventIds = [...new Set([...scopeByEventId.values()].flatMap((scope) => scope.allEventIds))];

    const [
      categoriesCountByEvent,
      inscritosCountByEvent,
      tecnicosByEvent,
      groupMatchesByEvent,
      publishedMatchesByEvent,
      publishedResultsByEvent,
    ] = await Promise.all([
      this.prisma.category.groupBy({
        by: ["eventId"],
        where: {
          eventId: { in: allScopedEventIds },
          OR: [{ cbtmCategoryId: null }, { cbtmCategoryId: { notIn: IGNORED_CATEGORY_IDS } }],
        },
        _count: {
          _all: true,
        },
      }),
      this.prisma.athlete.groupBy({
        by: ["eventId"],
        where: {
          eventId: { in: allScopedEventIds },
          createdFromWarning: false,
        },
        _count: {
          _all: true,
        },
      }),
      this.prisma.athlete.findMany({
        where: {
          eventId: { in: allScopedEventIds },
          createdFromWarning: false,
          categories: {
            some: {
              category: {
                cbtmCategoryId: "99999999",
              },
            },
          },
        },
        select: {
          eventId: true,
          id: true,
        },
      }),
      this.prisma.match.groupBy({
        by: ["eventId"],
        where: {
          eventId: { in: allScopedEventIds },
          OR: [{ phase: "GRUPOS" }, { round: { contains: "grupo", mode: "insensitive" } }],
        },
        _count: {
          _all: true,
        },
      }),
      this.prisma.match.groupBy({
        by: ["eventId"],
        where: {
          eventId: { in: allScopedEventIds },
          phase: { in: ["GRUPOS", "RESULTADOS", "ELIMINATORIA"] },
        },
        _count: {
          _all: true,
        },
      }),
      this.prisma.match.groupBy({
        by: ["eventId"],
        where: {
          eventId: { in: allScopedEventIds },
          phase: { in: ["GRUPOS", "RESULTADOS", "ELIMINATORIA"] },
          OR: [{ winnerIndex: { not: null } }, { p1Sets: { not: null } }, { p2Sets: { not: null } }],
        },
        _count: {
          _all: true,
        },
      }),
    ]);

    const categoriasMap = new Map<number, number>();
    for (const row of categoriesCountByEvent) {
      categoriasMap.set(row.eventId, row._count._all);
    }

    const inscritosMap = new Map<number, number>();
    for (const row of inscritosCountByEvent) {
      inscritosMap.set(row.eventId, row._count._all);
    }

    const tecnicosMap = new Map<number, number>();
    for (const athlete of tecnicosByEvent) {
      tecnicosMap.set(athlete.eventId, (tecnicosMap.get(athlete.eventId) ?? 0) + 1);
    }

    const groupsDefinedByEventMap = new Map<number, boolean>();
    for (const row of groupMatchesByEvent) {
      groupsDefinedByEventMap.set(row.eventId, row._count._all > 0);
    }

    const publishedMatchesByEventMap = new Map<number, boolean>();
    for (const row of publishedMatchesByEvent) {
      publishedMatchesByEventMap.set(row.eventId, row._count._all > 0);
    }

    const publishedResultsByEventMap = new Map<number, boolean>();
    for (const row of publishedResultsByEvent) {
      publishedResultsByEventMap.set(row.eventId, row._count._all > 0);
    }

    const lastScrapeByEventId = new Map<number, Date>();
    for (const event of events) {
      if (event.lastScrapeAt) {
        lastScrapeByEventId.set(event.id, event.lastScrapeAt);
      }
    }

    return displayEvents.map((event) => {
      const scope = scopeByEventId.get(event.id) ?? {
        canonicalEventId: event.id,
        allEventIds: [event.id],
        childSuffixByEventId: new Map<number, string>(),
      };

      const totalCategorias = scope.allEventIds.reduce((sum, currentEventId) => sum + (categoriasMap.get(currentEventId) ?? 0), 0);
      const totalInscritos = scope.allEventIds.reduce((sum, currentEventId) => sum + (inscritosMap.get(currentEventId) ?? 0), 0);
      const totalTecnicos = scope.allEventIds.reduce((sum, currentEventId) => sum + (tecnicosMap.get(currentEventId) ?? 0), 0);
      const groupsDefined = scope.allEventIds.some((currentEventId) => groupsDefinedByEventMap.get(currentEventId) ?? false);
      const hasPublishedMatches = scope.allEventIds.some((currentEventId) => publishedMatchesByEventMap.get(currentEventId) ?? false);
      const hasPublishedResults = scope.allEventIds.some((currentEventId) => publishedResultsByEventMap.get(currentEventId) ?? false);
      const mergedLastScrape = scope.allEventIds
        .map((currentEventId) => lastScrapeByEventId.get(currentEventId) ?? null)
        .filter((item): item is Date => Boolean(item))
        .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

      return {
        ...event,
        lastScrapeAt: mergedLastScrape,
        situacaoComputada: computeEventSituation({
          inicioInscricoes: event.inicioInscricoes,
          fimInscricoes: event.fimInscricoes,
          inicioRealizacao: event.inicioRealizacao,
          fimRealizacao: event.fimRealizacao,
          dataInicio: event.dataInicio,
          dataFim: event.dataFim,
          hasPublishedMatches,
          hasPublishedResults,
        }),
        totalCategorias,
        totalInscritos,
        totalTecnicos,
        groupsDefined,
      };
    }).map((event) => {
      const userStatus = resolveUserEventStatus({
        concluido: event.concluido,
        eventSituation: event.situacaoComputada,
      });
      const groupSimulationEligible = canUseGroupSimulation({
        concluido: event.concluido,
        groupsDefined: event.groupsDefined,
        eventSituation: event.situacaoComputada,
      });

      return {
        ...event,
        userStatus,
        groupSimulationEligible,
      };
    });
  }

  async listAthletes(eventId: number, search: string) {
    const scope = await this.resolveEventScope(eventId);
    await this.ensureEvent(scope.canonicalEventId);

    return this.prisma.athlete.findMany({
      where: {
        eventId: { in: scope.allEventIds },
        createdFromWarning: false,
        nameDisplay: {
          contains: search || undefined,
          mode: "insensitive",
        },
      },
      include: {
        club: true,
      },
      orderBy: [{ nameDisplay: "asc" }],
    });
  }

  async listClubs(eventId: number, search: string, categoryId: number | null) {
    const scope = await this.resolveEventScope(eventId);
    await this.ensureEvent(scope.canonicalEventId);
    if (categoryId) {
      await this.ensureCategoryOfEvent(scope.allEventIds, categoryId);
    }

    const clubs = await this.prisma.club.findMany({
      where: {
        name: {
          contains: search || undefined,
          mode: "insensitive",
        },
        athletes: {
          some: {
            eventId: { in: scope.allEventIds },
            createdFromWarning: false,
            categories: categoryId
              ? {
                  some: {
                    categoryId,
                  },
                }
              : undefined,
          },
        },
      },
      select: {
        id: true,
        name: true,
      },
      orderBy: [{ name: "asc" }],
    });

    if (clubs.length === 0) {
      return [];
    }

    const clubIds = clubs.map((club) => club.id);
    const athletesByClub = await this.prisma.athlete.groupBy({
      by: ["clubId"],
      where: {
        eventId: { in: scope.allEventIds },
        createdFromWarning: false,
        clubId: { in: clubIds },
        categories: categoryId
          ? {
              some: {
                categoryId,
              },
            }
          : undefined,
      },
      _count: {
        _all: true,
      },
    });

    const athleteCountByClub = new Map<number, number>();
    for (const row of athletesByClub) {
      athleteCountByClub.set(row.clubId, row._count._all);
    }

    return clubs.map((club) => ({
      ...club,
      athleteCount: athleteCountByClub.get(club.id) ?? 0,
    }));
  }

  async listCategories(eventId: number) {
    const scope = await this.resolveEventScope(eventId);
    await this.ensureEvent(scope.canonicalEventId);

    const categories = await this.prisma.category.findMany({
      where: {
        eventId: { in: scope.allEventIds },
        OR: [{ cbtmCategoryId: null }, { cbtmCategoryId: { notIn: IGNORED_CATEGORY_IDS } }],
      },
      orderBy: [{ name: "asc" }],
      select: {
        id: true,
        eventId: true,
        name: true,
        normalizedName: true,
        cbtmCategoryId: true,
      },
    });

    return categories.map((category) => ({
      ...category,
      name:
        category.eventId === scope.canonicalEventId
          ? category.name
          : `${category.name}${scope.childSuffixByEventId.get(category.eventId) ?? " -X"}`,
    }));
  }

  async listEventEfficiency(eventId: number) {
    const scope = await this.resolveEventScope(eventId);
    await this.ensureEvent(scope.canonicalEventId);
    const response = await this.computeEfficiencyRanking({ eventIds: scope.allEventIds });
    return {
      eventId: scope.canonicalEventId,
      ...response,
    };
  }

  async listGlobalEfficiency() {
    const now = Date.now();
    if (this.globalEfficiencyCache && this.globalEfficiencyCache.expiresAt > now) {
      return this.globalEfficiencyCache.data;
    }

    const data = await this.computeEfficiencyRanking({});
    this.globalEfficiencyCache = {
      expiresAt: now + UserService.EFFICIENCY_CACHE_TTL_MS,
      data,
    };
    return data;
  }

  private async computeEfficiencyRanking(input: { eventIds?: number[] }) {
    const hasScopedEvents = Array.isArray(input.eventIds) && input.eventIds.length > 0;
    const eventFilter = hasScopedEvents ? { eventId: { in: input.eventIds } } : {};
    const athleteFilter = {
      ...eventFilter,
      createdFromWarning: false,
    };
    const categoryFilter =
      hasScopedEvents
        ? {
            eventId: { in: input.eventIds },
            OR: [{ cbtmCategoryId: null }, { cbtmCategoryId: { notIn: IGNORED_CATEGORY_IDS } }],
          }
        : {
            OR: [{ cbtmCategoryId: null }, { cbtmCategoryId: { notIn: IGNORED_CATEGORY_IDS } }],
          };

    const [weights, clubs, categories] = await Promise.all([
      this.getEfficiencyWeights(),
      this.prisma.club.findMany({
        where: {
          athletes: {
            some: {
              ...athleteFilter,
            },
          },
        },
        select: {
          id: true,
          name: true,
          athletes: {
            where: {
              ...athleteFilter,
            },
            select: {
              id: true,
              nameDisplay: true,
              clubId: true,
            },
          },
        },
      }),
      this.prisma.category.findMany({
        where: categoryFilter,
        select: {
          id: true,
        },
      }),
    ]);

    const rowsByClubId = new Map<number, ClubEfficiencyRow>();
    const athleteClubByAthleteId = new Map<number, number>();

    for (const club of clubs) {
      rowsByClubId.set(club.id, {
        clubId: club.id,
        clubName: club.name,
        athleteCount: club.athletes.length,
        ouro: 0,
        prata: 0,
        bronze: 0,
        totalQuantidade: 0,
        totalPontuacao: 0,
        pontuacao: {
          ouro: 0,
          prata: 0,
          bronze: 0,
          total: 0,
        },
      });

      for (const athlete of club.athletes) {
        athleteClubByAthleteId.set(athlete.id, athlete.clubId);
      }
    }

    const categoryIds = categories.map((category) => category.id);
    if (categoryIds.length === 0 || rowsByClubId.size === 0) {
      return { weights, ranking: [...rowsByClubId.values()] };
    }

    const [athleteCategories, fullCategoryMatchesRaw] = await Promise.all([
      this.prisma.athleteCategory.findMany({
        where: {
          categoryId: { in: categoryIds },
          athlete: {
            ...athleteFilter,
          },
        },
        select: {
          categoryId: true,
          athlete: {
            select: {
              id: true,
              nameDisplay: true,
              clubId: true,
            },
          },
        },
      }),
      this.prisma.match.findMany({
        where: {
          categoryId: { in: categoryIds },
          ...eventFilter,
        },
        include: {
          category: true,
          participants: {
            include: {
              athlete: {
                include: {
                  club: true,
                },
              },
            },
          },
        },
      }),
    ]);

    const categoryAthletesMap = new Map<
      number,
      Array<{ athleteId: number; athleteName: string; clubId: number }>
    >();

    for (const item of athleteCategories) {
      const bucket = categoryAthletesMap.get(item.categoryId) ?? [];
      bucket.push({
        athleteId: item.athlete.id,
        athleteName: item.athlete.nameDisplay,
        clubId: item.athlete.clubId,
      });
      categoryAthletesMap.set(item.categoryId, bucket);
    }

    const fullCategoryMatchesMap = new Map<number, CategoryAnalyticsMatch[]>();
    for (const match of fullCategoryMatchesRaw) {
      const analytics = this.buildCategoryAnalyticsMatchFromRaw(match);
      if (!analytics) {
        continue;
      }
      const bucket = fullCategoryMatchesMap.get(match.categoryId) ?? [];
      bucket.push(analytics);
      fullCategoryMatchesMap.set(match.categoryId, bucket);
    }

    for (const categoryId of categoryIds) {
      const athletesInCategory = categoryAthletesMap.get(categoryId) ?? [];
      if (athletesInCategory.length === 0) {
        continue;
      }

      const fullCategoryMatches = fullCategoryMatchesMap.get(categoryId) ?? [];
      const positionByAthleteId = this.computeCategoryPositionByAthleteId(
        fullCategoryMatches,
        athletesInCategory.map((athlete) => ({
          athleteId: athlete.athleteId,
          athleteName: athlete.athleteName,
        })),
      );

      for (const athlete of athletesInCategory) {
        const position = positionByAthleteId.get(athlete.athleteId) ?? null;
        if (position !== 1 && position !== 2 && position !== 3) {
          continue;
        }

        const clubId = athleteClubByAthleteId.get(athlete.athleteId) ?? athlete.clubId;
        const row = rowsByClubId.get(clubId);
        if (!row) {
          continue;
        }

        if (position === 1) {
          row.ouro += 1;
        } else if (position === 2) {
          row.prata += 1;
        } else if (position === 3) {
          row.bronze += 1;
        }
      }
    }

    for (const row of rowsByClubId.values()) {
      row.totalQuantidade = row.ouro + row.prata + row.bronze;
      row.pontuacao.ouro = row.ouro * weights.pesoOuro;
      row.pontuacao.prata = row.prata * weights.pesoPrata;
      row.pontuacao.bronze = row.bronze * weights.pesoBronze;
      row.pontuacao.total = row.pontuacao.ouro + row.pontuacao.prata + row.pontuacao.bronze;
      row.totalPontuacao = row.pontuacao.total;
    }

    const ranking = [...rowsByClubId.values()].sort((left, right) => {
      if (left.ouro !== right.ouro) {
        return right.ouro - left.ouro;
      }
      if (left.prata !== right.prata) {
        return right.prata - left.prata;
      }
      if (left.bronze !== right.bronze) {
        return right.bronze - left.bronze;
      }
      if (left.totalPontuacao !== right.totalPontuacao) {
        return right.totalPontuacao - left.totalPontuacao;
      }
      return left.clubName.localeCompare(right.clubName, "pt-BR", { sensitivity: "base" });
    });

    return { weights, ranking };
  }

  async getClubEfficiencyCareer(clubId: number) {
    const now = Date.now();
    const cacheHit = this.clubEfficiencyCache.get(clubId);
    if (cacheHit && cacheHit.expiresAt > now) {
      return cacheHit.data;
    }

    const club = await this.prisma.club.findUnique({
      where: { id: clubId },
      select: { id: true, name: true },
    });

    if (!club) {
      throw new NotFoundException("Clube nao encontrado");
    }

    const [weights, athletesByEvent] = await Promise.all([
      this.getEfficiencyWeights(),
      this.prisma.athlete.findMany({
        where: {
          clubId,
          createdFromWarning: false,
        },
        select: {
          id: true,
          nameDisplay: true,
          eventId: true,
        },
      }),
    ]);

    const eventIds = [...new Set(athletesByEvent.map((athlete) => athlete.eventId))];
    if (eventIds.length === 0) {
      return {
        club: { id: club.id, name: club.name },
        weights,
        summary: {
          nEventos: 0,
          ultimoEventoNome: null as string | null,
          ultimoEventoId: null as number | null,
          nAtletasUltimoEvento: 0,
        },
        broadcastByType: {
          BRASILEIRAO: { ouro: 0, prata: 0, bronze: 0, total: 0 },
          COPA: { ouro: 0, prata: 0, bronze: 0, total: 0 },
          ESTADUAL: { ouro: 0, prata: 0, bronze: 0, total: 0 },
          OPEN: { ouro: 0, prata: 0, bronze: 0, total: 0 },
        },
        scoreCard: {
          quantidade: { ouro: 0, prata: 0, bronze: 0, total: 0 },
          pontuacao: { ouro: 0, prata: 0, bronze: 0, total: 0 },
        },
        history: [] as Array<{
          eventId: number;
          eventName: string;
          eventType: EfficiencyCompetitionType;
          dataInicio: Date | null;
          dataFim: Date | null;
          athleteCount: number;
          ouro: number;
          prata: number;
          bronze: number;
          totalQuantidade: number;
          pontuacao: { ouro: number; prata: number; bronze: number; total: number };
          medalists: EfficiencyHistoryMedalist[];
        }>,
        athletesContribution: [] as Array<{
          athleteId: number;
          athleteName: string;
          eventos: number;
          ouro: number;
          prata: number;
          bronze: number;
          totalQuantidade: number;
          pontuacao: { ouro: number; prata: number; bronze: number; total: number };
        }>,
      };
    }

    const [events, categories, fullCategoryMatchesRaw] = await Promise.all([
      this.prisma.event.findMany({
        where: { id: { in: eventIds } },
        select: {
          id: true,
          nome: true,
          nivel: true,
          concluido: true,
          inicioRealizacao: true,
          fimRealizacao: true,
          dataInicio: true,
          dataFim: true,
        },
      }),
      this.prisma.category.findMany({
        where: {
          eventId: { in: eventIds },
          OR: [{ cbtmCategoryId: null }, { cbtmCategoryId: { notIn: IGNORED_CATEGORY_IDS } }],
        },
        select: {
          id: true,
          eventId: true,
          name: true,
        },
      }),
      this.prisma.match.findMany({
        where: {
          eventId: { in: eventIds },
          category: {
            OR: [{ cbtmCategoryId: null }, { cbtmCategoryId: { notIn: IGNORED_CATEGORY_IDS } }],
          },
        },
        include: {
          category: true,
          participants: {
            include: {
              athlete: {
                include: {
                  club: true,
                },
              },
            },
          },
        },
      }),
    ]);

    const eventById = new Map(events.map((event) => [event.id, event]));
    const categoryById = new Map(categories.map((category) => [category.id, category]));
    const categoryIds = categories.map((category) => category.id);

    const athleteCategories = categoryIds.length
      ? await this.prisma.athleteCategory.findMany({
          where: {
            categoryId: { in: categoryIds },
            athlete: {
              clubId,
              createdFromWarning: false,
            },
          },
          select: {
            categoryId: true,
            athlete: {
              select: {
                id: true,
                nameDisplay: true,
              },
            },
          },
        })
      : [];

    const clubAthletesInCategory = new Map<
      number,
      Array<{ athleteId: number; athleteName: string }>
    >();
    for (const row of athleteCategories) {
      const athletes = clubAthletesInCategory.get(row.categoryId) ?? [];
      athletes.push({
        athleteId: row.athlete.id,
        athleteName: row.athlete.nameDisplay,
      });
      clubAthletesInCategory.set(row.categoryId, athletes);
    }

    const fullCategoryMatchesMap = new Map<number, CategoryAnalyticsMatch[]>();
    for (const match of fullCategoryMatchesRaw) {
      const analytics = this.buildCategoryAnalyticsMatchFromRaw(match);
      if (!analytics) continue;
      const bucket = fullCategoryMatchesMap.get(match.categoryId) ?? [];
      bucket.push(analytics);
      fullCategoryMatchesMap.set(match.categoryId, bucket);
    }

    const athleteNameByGroupKey = new Map<string, string>();
    const athletePrimaryIdByGroupKey = new Map<string, number>();
    const athleteEventSetByGroupKey = new Map<string, Set<number>>();
    const athleteGroupKeyById = new Map<number, string>();
    const athleteCountByEvent = new Map<number, number>();
    for (const row of athletesByEvent) {
      const normalized = normalizeAthleteName(row.nameDisplay);
      const groupKey = normalized ? `name:${normalized}` : `id:${row.id}`;
      const currentName = athleteNameByGroupKey.get(groupKey);
      if (!currentName || row.nameDisplay.length > currentName.length) {
        athleteNameByGroupKey.set(groupKey, row.nameDisplay);
      }
      const currentPrimaryId = athletePrimaryIdByGroupKey.get(groupKey);
      if (!currentPrimaryId || row.id < currentPrimaryId) {
        athletePrimaryIdByGroupKey.set(groupKey, row.id);
      }
      athleteGroupKeyById.set(row.id, groupKey);
      const set = athleteEventSetByGroupKey.get(groupKey) ?? new Set<number>();
      set.add(row.eventId);
      athleteEventSetByGroupKey.set(groupKey, set);
      athleteCountByEvent.set(row.eventId, (athleteCountByEvent.get(row.eventId) ?? 0) + 1);
    }

    const medalsByType = new Map<EfficiencyCompetitionType, EfficiencyMedalCounter>([
      ["BRASILEIRAO", createEmptyEfficiencyMedalCounter()],
      ["COPA", createEmptyEfficiencyMedalCounter()],
      ["ESTADUAL", createEmptyEfficiencyMedalCounter()],
      ["OPEN", createEmptyEfficiencyMedalCounter()],
    ]);

    const totals = createEmptyEfficiencyMedalCounter();
    const historyByEvent = new Map<
      number,
      {
        eventId: number;
        eventName: string;
        eventType: EfficiencyCompetitionType;
        dataInicio: Date | null;
        dataFim: Date | null;
        athleteCount: number;
        medals: EfficiencyMedalCounter;
        medalists: EfficiencyHistoryMedalist[];
      }
    >();
    const contributionByAthleteGroupKey = new Map<string, EfficiencyMedalCounter>();
    const medalistDedup = new Set<string>();

    for (const category of categories) {
      const categoryAthletes = clubAthletesInCategory.get(category.id) ?? [];
      if (categoryAthletes.length === 0) continue;
      const categoryMatches = fullCategoryMatchesMap.get(category.id) ?? [];
      const positionByAthleteId = this.computeCategoryPositionByAthleteId(
        categoryMatches,
        categoryAthletes.map((athlete) => ({
          athleteId: athlete.athleteId,
          athleteName: athlete.athleteName,
        })),
      );

      const event = eventById.get(category.eventId);
      if (!event) continue;
      const eventType = toEfficiencyCompetitionType(event.nivel);
      const eventMedals = medalsByType.get(eventType) ?? createEmptyEfficiencyMedalCounter();

      const historyEntry =
        historyByEvent.get(event.id) ??
        {
          eventId: event.id,
          eventName: event.nome,
          eventType,
          dataInicio: event.dataInicio,
          dataFim: event.dataFim,
          athleteCount: athleteCountByEvent.get(event.id) ?? 0,
          medals: createEmptyEfficiencyMedalCounter(),
          medalists: [],
        };

      for (const athlete of categoryAthletes) {
        const position = positionByAthleteId.get(athlete.athleteId) ?? null;
        if (position !== 1 && position !== 2 && position !== 3) continue;

        let medal: "ouro" | "prata" | "bronze";
        if (position === 1) medal = "ouro";
        else if (position === 2) medal = "prata";
        else medal = "bronze";

        totals[medal] += 1;
        eventMedals[medal] += 1;
        historyEntry.medals[medal] += 1;

        const athleteGroupKey = athleteGroupKeyById.get(athlete.athleteId) ?? `id:${athlete.athleteId}`;
        const contribution =
          contributionByAthleteGroupKey.get(athleteGroupKey) ?? createEmptyEfficiencyMedalCounter();
        contribution[medal] += 1;
        contributionByAthleteGroupKey.set(athleteGroupKey, contribution);

        const dedupKey = `${event.id}:${category.id}:${athlete.athleteId}:${medal}`;
        if (!medalistDedup.has(dedupKey)) {
          medalistDedup.add(dedupKey);
          historyEntry.medalists.push({
            athleteId: athlete.athleteId,
            athleteName:
              athleteNameByGroupKey.get(athleteGroupKeyById.get(athlete.athleteId) ?? "") ??
              athlete.athleteName,
            categoryName: categoryById.get(category.id)?.name ?? "-",
            medalha: medal,
          });
        }
      }

      medalsByType.set(eventType, eventMedals);
      historyByEvent.set(event.id, historyEntry);
    }

    const timelineNow = Date.now();
    const concludedEvents = events.filter((event) => event.concluido);
    const upcomingEvents = events.filter((event) => {
      if (event.concluido) {
        return false;
      }
      const startDate = event.inicioRealizacao ?? event.dataInicio;
      if (!startDate) {
        return false;
      }
      return new Date(startDate).getTime() > timelineNow;
    });

    const sortedConcludedEvents = [...concludedEvents].sort((left, right) => {
      const leftDate = left.fimRealizacao ?? left.dataFim ?? left.dataInicio;
      const rightDate = right.fimRealizacao ?? right.dataFim ?? right.dataInicio;
      const leftTs = leftDate ? new Date(leftDate).getTime() : Number.MIN_SAFE_INTEGER;
      const rightTs = rightDate ? new Date(rightDate).getTime() : Number.MIN_SAFE_INTEGER;
      if (leftTs !== rightTs) return rightTs - leftTs;
      return right.id - left.id;
    });
    const sortedUpcomingEvents = [...upcomingEvents].sort((left, right) => {
      const leftDate = left.inicioRealizacao ?? left.dataInicio;
      const rightDate = right.inicioRealizacao ?? right.dataInicio;
      const leftTs = leftDate ? new Date(leftDate).getTime() : Number.MAX_SAFE_INTEGER;
      const rightTs = rightDate ? new Date(rightDate).getTime() : Number.MAX_SAFE_INTEGER;
      if (leftTs !== rightTs) return leftTs - rightTs;
      return left.id - right.id;
    });

    const sortedEvents = [...events].sort((left, right) => {
      const leftDate = left.dataInicio ? new Date(left.dataInicio).getTime() : Number.MIN_SAFE_INTEGER;
      const rightDate = right.dataInicio ? new Date(right.dataInicio).getTime() : Number.MIN_SAFE_INTEGER;
      if (leftDate !== rightDate) return rightDate - leftDate;
      return right.id - left.id;
    });
    const latestEvent = sortedConcludedEvents[0] ?? null;
    const nextEvent = sortedUpcomingEvents[0] ?? null;
    const latestAthletesCount = latestEvent ? athleteCountByEvent.get(latestEvent.id) ?? 0 : 0;
    const nextAthletesCount = nextEvent ? athleteCountByEvent.get(nextEvent.id) ?? 0 : 0;

    const history = [...historyByEvent.values()]
      .map((row) => {
        const pontuacao = {
          ouro: row.medals.ouro * weights.pesoOuro,
          prata: row.medals.prata * weights.pesoPrata,
          bronze: row.medals.bronze * weights.pesoBronze,
          total: 0,
        };
        pontuacao.total = pontuacao.ouro + pontuacao.prata + pontuacao.bronze;
        return {
          eventId: row.eventId,
          eventName: row.eventName,
          eventType: row.eventType,
          dataInicio: row.dataInicio,
          dataFim: row.dataFim,
          athleteCount: row.athleteCount,
          ouro: row.medals.ouro,
          prata: row.medals.prata,
          bronze: row.medals.bronze,
          totalQuantidade: totalEfficiencyMedals(row.medals),
          pontuacao,
          medalists: row.medalists.sort((left, right) => {
            const medalOrder = { ouro: 0, prata: 1, bronze: 2 };
            const diff = medalOrder[left.medalha] - medalOrder[right.medalha];
            if (diff !== 0) return diff;
            return left.athleteName.localeCompare(right.athleteName, "pt-BR", { sensitivity: "base" });
          }),
        };
      })
      .filter((row) => row.totalQuantidade > 0)
      .sort((left, right) => {
        const leftDate = left.dataInicio ? new Date(left.dataInicio).getTime() : Number.MIN_SAFE_INTEGER;
        const rightDate = right.dataInicio ? new Date(right.dataInicio).getTime() : Number.MIN_SAFE_INTEGER;
        if (leftDate !== rightDate) return rightDate - leftDate;
        return left.eventName.localeCompare(right.eventName, "pt-BR", { sensitivity: "base" });
      });

    const athletesContribution = [...athleteNameByGroupKey.entries()]
      .map(([groupKey, athleteName]) => {
        const medals = contributionByAthleteGroupKey.get(groupKey) ?? createEmptyEfficiencyMedalCounter();
        const pontuacao = {
          ouro: medals.ouro * weights.pesoOuro,
          prata: medals.prata * weights.pesoPrata,
          bronze: medals.bronze * weights.pesoBronze,
          total: 0,
        };
        pontuacao.total = pontuacao.ouro + pontuacao.prata + pontuacao.bronze;
        return {
          athleteId: athletePrimaryIdByGroupKey.get(groupKey) ?? 0,
          athleteName,
          eventos: athleteEventSetByGroupKey.get(groupKey)?.size ?? 0,
          ouro: medals.ouro,
          prata: medals.prata,
          bronze: medals.bronze,
          totalQuantidade: totalEfficiencyMedals(medals),
          pontuacao,
        };
      })
      .filter((row) => row.totalQuantidade > 0)
      .sort((left, right) => {
        if (left.ouro !== right.ouro) return right.ouro - left.ouro;
        if (left.prata !== right.prata) return right.prata - left.prata;
        if (left.bronze !== right.bronze) return right.bronze - left.bronze;
        if (left.totalQuantidade !== right.totalQuantidade) return right.totalQuantidade - left.totalQuantidade;
        return left.athleteName.localeCompare(right.athleteName, "pt-BR", { sensitivity: "base" });
      });

    const quantidade = {
      ouro: totals.ouro,
      prata: totals.prata,
      bronze: totals.bronze,
      total: totalEfficiencyMedals(totals),
    };
    const pontuacao = {
      ouro: quantidade.ouro * weights.pesoOuro,
      prata: quantidade.prata * weights.pesoPrata,
      bronze: quantidade.bronze * weights.pesoBronze,
      total: 0,
    };
    pontuacao.total = pontuacao.ouro + pontuacao.prata + pontuacao.bronze;

    const medalsBrasileirao = medalsByType.get("BRASILEIRAO") ?? createEmptyEfficiencyMedalCounter();
    const medalsCopa = medalsByType.get("COPA") ?? createEmptyEfficiencyMedalCounter();
    const medalsEstadual = medalsByType.get("ESTADUAL") ?? createEmptyEfficiencyMedalCounter();
    const medalsOpen = medalsByType.get("OPEN") ?? createEmptyEfficiencyMedalCounter();

    const response = {
      club: { id: club.id, name: club.name },
      weights,
      summary: {
        nEventos: eventIds.length,
        ultimoEventoNome: latestEvent?.nome ?? null,
        ultimoEventoId: latestEvent?.id ?? null,
        nAtletasUltimoEvento: latestAthletesCount,
        proximoEventoNome: nextEvent?.nome ?? null,
        proximoEventoId: nextEvent?.id ?? null,
        nAtletasProximoEvento: nextAthletesCount,
        medalhasTotais: {
          ouro: quantidade.ouro,
          prata: quantidade.prata,
          bronze: quantidade.bronze,
          total: quantidade.total,
        },
      },
      broadcastByType: {
        BRASILEIRAO: {
          ...medalsBrasileirao,
          total: totalEfficiencyMedals(medalsBrasileirao),
        },
        COPA: {
          ...medalsCopa,
          total: totalEfficiencyMedals(medalsCopa),
        },
        ESTADUAL: {
          ...medalsEstadual,
          total: totalEfficiencyMedals(medalsEstadual),
        },
        OPEN: {
          ...medalsOpen,
          total: totalEfficiencyMedals(medalsOpen),
        },
      },
      scoreCard: {
        quantidade,
        pontuacao,
      },
      history,
      athletesContribution,
    };
    this.clubEfficiencyCache.set(clubId, {
      expiresAt: now + UserService.EFFICIENCY_CACHE_TTL_MS,
      data: response,
    });
    return response;
  }

  private computeCategoryPositionByAthleteId(
    categoryMatches: CategoryAnalyticsMatch[],
    athletes: Array<{ athleteId: number; athleteName: string }>,
  ): Map<number, number | null> {
    if (athletes.length === 0) {
      return new Map<number, number | null>();
    }

    const uniqueAthletes = new Map<number, { athleteId: number; athleteName: string }>();
    for (const athlete of athletes) {
      if (!uniqueAthletes.has(athlete.athleteId)) {
        uniqueAthletes.set(athlete.athleteId, athlete);
      }
    }

    const positionByAthleteId = new Map<number, number | null>();
    for (const athlete of uniqueAthletes.values()) {
      const summary = computeCategoryClassificationSummaries(categoryMatches, {
        athleteIds: [athlete.athleteId],
        athleteName: athlete.athleteName,
        athleteNameNormalized: normalizeAthleteName(athlete.athleteName),
      })[0];
      positionByAthleteId.set(athlete.athleteId, summary?.position ?? null);
    }

    return positionByAthleteId;
  }

  async simulateGroups(
    eventId: number,
    categoryId: number | null,
    registrationScopeRaw?: string | null,
    debugMode = false,
  ) {
    const scope = await this.resolveEventScope(eventId);
    const event = await this.ensureEvent(scope.canonicalEventId);
    const publicationFlags = await this.readEventPublicationFlags(scope.allEventIds);
    const registrationScope: RegistrationScope = normalizeRegistrationScope(registrationScopeRaw ?? undefined);
    const eventSituation: EventSituation = computeEventSituation({
      inicioInscricoes: event.inicioInscricoes,
      fimInscricoes: event.fimInscricoes,
      inicioRealizacao: event.inicioRealizacao,
      fimRealizacao: event.fimRealizacao,
      dataInicio: event.dataInicio,
      dataFim: event.dataFim,
      hasPublishedMatches: publicationFlags.hasPublishedMatches,
      hasPublishedResults: publicationFlags.hasPublishedResults,
    });
    const groupsDefined = await this.eventHasOfficialGroups(scope.allEventIds);
    const simulationEligible = canUseGroupSimulation({
      concluido: event.concluido,
      groupsDefined,
      eventSituation,
    });
    if (!simulationEligible) {
      if (groupsDefined) {
        throw new BadRequestException(
          "Simulador indisponível: o evento já possui estrutura oficial de grupos.",
        );
      }
      throw new BadRequestException(
        `Simulador indisponível para situação '${eventSituation}'.`,
      );
    }

    const categories = await this.prisma.category.findMany({
      where: {
        eventId: { in: scope.allEventIds },
        id: categoryId ?? undefined,
        OR: [{ cbtmCategoryId: null }, { cbtmCategoryId: { notIn: IGNORED_CATEGORY_IDS } }],
        ...(categoryId === null
          ? {
              athletes: {
                some: {
                  athlete: {
                    eventId: { in: scope.allEventIds },
                    createdFromWarning: false,
                  },
                },
              },
            }
          : {}),
      },
      orderBy: [{ name: "asc" }],
      select: {
        id: true,
        eventId: true,
        name: true,
        normalizedName: true,
      },
    });

    const categoryIds = categories.map((category) => category.id);
    const categoryLinksAll = categoryIds.length
      ? await this.prisma.athleteCategory.findMany({
          where: {
            categoryId: { in: categoryIds },
            athlete: {
              eventId: { in: scope.allEventIds },
              createdFromWarning: false,
            },
          },
          include: {
            athlete: {
              include: {
                club: true,
              },
            },
          },
          orderBy: [{ categoryId: "asc" }, { athlete: { nameDisplay: "asc" } }],
        })
      : [];

    const linksByCategory = new Map<number, SimulationAthleteLink[]>();
    for (const link of categoryLinksAll as SimulationAthleteLink[]) {
      const bucket = linksByCategory.get(link.categoryId) ?? [];
      bucket.push(link);
      linksByCategory.set(link.categoryId, bucket);
    }

    const simulations = [];
    const omittedCategories: string[] = [];
    const athleteCountByCategory = new Map<number, number>();

    for (const category of categories) {
      const typedLinks = linksByCategory.get(category.id) ?? [];
      const scoped = selectAthletesByRegistrationScope(typedLinks, registrationScope);
      athleteCountByCategory.set(category.id, scoped.athletes.length);
    }

    const historicalPreferences = await this.inferHistoricalGroupPreferences({
      eventId: scope.canonicalEventId,
      categories,
      athleteCountByCategory,
    });

    for (const category of categories) {
      const typedLinks = linksByCategory.get(category.id) ?? [];
      const linkedAthleteIds = [...new Set(typedLinks.map((row) => row.athlete.id))];
      const breakdown: RegistrationBreakdown = computeRegistrationBreakdown(typedLinks);
      const scoped = selectAthletesByRegistrationScope(typedLinks, registrationScope);
      const scopedWarnings = [...scoped.warnings];
      const scopedByAthlete = new Map<number, (typeof scoped.athletes)[number]>();
      for (const athlete of scoped.athletes) {
        if (!scopedByAthlete.has(athlete.id)) {
          scopedByAthlete.set(athlete.id, athlete);
        }
      }
      if (typedLinks.length !== linkedAthleteIds.length) {
        scopedWarnings.push(
          `Detectados ${typedLinks.length - linkedAthleteIds.length} vinculo(s) duplicado(s) na base da categoria; simulacao normalizou por athleteId.`,
        );
      }
      if (scoped.athletes.length !== scopedByAthlete.size) {
        scopedWarnings.push(
          `Detectados ${scoped.athletes.length - scopedByAthlete.size} atleta(s) duplicado(s) no escopo; simulacao normalizou por athleteId.`,
        );
      }
      const athletes = [...scopedByAthlete.values()];
      const baseWarning =
        breakdown.total === 0
          ? "Categoria listada sem vinculos de atleta-categoria no banco."
          : `Categoria sem atletas no escopo '${registrationScope}' (vinculos=${linkedAthleteIds.length}, considerados=${athletes.length}).`;

      if (athletes.length === 0) {
        const reason =
          breakdown.total === 0
            ? "categoria_sem_vinculo_athlete_category"
            : registrationScope === "confirmed"
            ? "categoria_sem_inscritos_confirmados"
            : "categoria_sem_atletas_no_escopo";
        if (categoryId !== null) {
          const categoryLabel =
            category.eventId === scope.canonicalEventId
              ? category.name
              : `${category.name}${scope.childSuffixByEventId.get(category.eventId) ?? " -X"}`;
          simulations.push({
            categoryId: category.id,
            categoryName: categoryLabel,
            status: "skipped",
            reason,
            groups: [],
            stats: null,
            registration: {
              scope: registrationScope,
              ...breakdown,
              linkedAthletesCount: linkedAthleteIds.length,
              scopedAthletesCount: 0,
              considered: 0,
              consideredAthleteIds: debugMode ? [] : undefined,
            },
            warnings: sanitizeUserWarnings([baseWarning, ...scopedWarnings]),
          });
        } else {
          const categoryLabel =
            category.eventId === scope.canonicalEventId
              ? category.name
              : `${category.name}${scope.childSuffixByEventId.get(category.eventId) ?? " -X"}`;
          omittedCategories.push(`${categoryLabel} (${reason})`);
        }
        continue;
      }

      if (!hasMinimumSimulationAthletes(athletes.length)) {
        const reason = "categoria_com_menos_de_tres_atletas";
        const warning = `Categoria com ${athletes.length} atleta(s) no escopo. Mínimo para simulação: 3.`;
        if (categoryId !== null) {
          const categoryLabel =
            category.eventId === scope.canonicalEventId
              ? category.name
              : `${category.name}${scope.childSuffixByEventId.get(category.eventId) ?? " -X"}`;
          simulations.push({
            categoryId: category.id,
            categoryName: categoryLabel,
            status: "skipped",
            reason,
            groups: [],
            stats: null,
            registration: {
              scope: registrationScope,
              ...breakdown,
              linkedAthletesCount: linkedAthleteIds.length,
              scopedAthletesCount: athletes.length,
              considered: athletes.length,
              consideredAthleteIds: debugMode ? athletes.map((athlete) => athlete.id) : undefined,
            },
            warnings: sanitizeUserWarnings([warning, ...scopedWarnings]),
          });
        } else {
          const categoryLabel =
            category.eventId === scope.canonicalEventId
              ? category.name
              : `${category.name}${scope.childSuffixByEventId.get(category.eventId) ?? " -X"}`;
          omittedCategories.push(`${categoryLabel} (${reason})`);
        }
        continue;
      }

      const historical = historicalPreferences.get(category.id) ?? {
        preferredGroupCount: null,
        sampleSize: 0,
      };
      const simulation = simulateGroupsForCategory({
        seed: `event:${scope.canonicalEventId}:category:${category.id}:scope:${registrationScope}`,
        categoryName: category.name,
        athletes: athletes.map((athlete) => ({
          athleteId: athlete.id,
          nameDisplay: athlete.nameDisplay,
          clubId: athlete.clubId,
          clubName: athlete.club?.name ?? null,
          rankingPoints: athlete.rankingPoints,
          ratingPoints: athlete.ratingPoints,
        })),
        preferredGroupCount: historical.preferredGroupCount,
      });
      const useRatingPoints = simulation.stats.sortBasis === "rating";

      simulations.push({
        categoryName:
          category.eventId === scope.canonicalEventId
            ? category.name
            : `${category.name}${scope.childSuffixByEventId.get(category.eventId) ?? " -X"}`,
        categoryId: category.id,
        status: "simulated",
        reason: null,
        groups: simulation.groups.map((group) => ({
          groupName: group.groupName,
          athletes: [...group.athletes]
            .sort((left, right) => {
              const leftPrimary = useRatingPoints
                ? (left.ratingPoints ?? left.rankingPoints ?? Number.MIN_SAFE_INTEGER)
                : (left.rankingPoints ?? left.ratingPoints ?? Number.MIN_SAFE_INTEGER);
              const rightPrimary = useRatingPoints
                ? (right.ratingPoints ?? right.rankingPoints ?? Number.MIN_SAFE_INTEGER)
                : (right.rankingPoints ?? right.ratingPoints ?? Number.MIN_SAFE_INTEGER);
              if (leftPrimary !== rightPrimary) {
                return rightPrimary - leftPrimary;
              }

              const leftSecondary = useRatingPoints
                ? (left.rankingPoints ?? Number.MIN_SAFE_INTEGER)
                : (left.ratingPoints ?? Number.MIN_SAFE_INTEGER);
              const rightSecondary = useRatingPoints
                ? (right.rankingPoints ?? Number.MIN_SAFE_INTEGER)
                : (right.ratingPoints ?? Number.MIN_SAFE_INTEGER);
              if (leftSecondary !== rightSecondary) {
                return rightSecondary - leftSecondary;
              }

              const byName = left.nameDisplay.localeCompare(right.nameDisplay, "pt-BR", {
                sensitivity: "base",
              });
              if (byName !== 0) {
                return byName;
              }

              return left.athleteId - right.athleteId;
            })
            .map((athlete) => ({
            athleteId: athlete.athleteId,
            nameDisplay: athlete.nameDisplay,
            nameReduced: toReducedName(athlete.nameDisplay),
            clubName: athlete.clubName,
            rankingPoints: athlete.rankingPoints,
            ratingPoints: athlete.ratingPoints,
          })),
        })),
        stats: {
          ...simulation.stats,
          historicalSampleSize: historical.sampleSize,
        },
        registration: {
          scope: registrationScope,
          ...breakdown,
          linkedAthletesCount: linkedAthleteIds.length,
          scopedAthletesCount: athletes.length,
          considered: athletes.length,
          consideredAthleteIds: debugMode ? athletes.map((athlete) => athlete.id) : undefined,
        },
        warnings: sanitizeUserWarnings([...simulation.warnings, ...scopedWarnings]),
      });
    }

    const warnings = omittedCategories.length
      ? [`Categorias omitidas por falta de atletas no escopo: ${omittedCategories.join(", ")}.`]
      : [];

    return {
      eventId: scope.canonicalEventId,
      eventSituation,
      groupsDefined,
      registrationScope,
      warnings: sanitizeUserWarnings(warnings),
      categories: simulations,
    };
  }

  async listClubAthletes(eventId: number, clubId: number, categoryId: number | null) {
    const scope = await this.resolveEventScope(eventId);
    await this.ensureEvent(scope.canonicalEventId);
    if (categoryId) {
      await this.ensureCategoryOfEvent(scope.allEventIds, categoryId);
    }

    const club = await this.prisma.club.findFirst({
      where: {
        id: clubId,
        athletes: {
          some: {
            eventId: { in: scope.allEventIds },
            categories: categoryId
              ? {
                  some: {
                    categoryId,
                  },
                }
              : undefined,
          },
        },
      },
    });

    if (!club) {
      throw new NotFoundException("Clube nao encontrado para o evento");
    }

    const athletes = await this.prisma.athlete.findMany({
      where: {
        eventId: { in: scope.allEventIds },
        clubId,
        createdFromWarning: false,
        categories: categoryId
          ? {
              some: {
                categoryId,
              },
            }
          : undefined,
      },
      orderBy: [{ nameDisplay: "asc" }],
    });

    return {
      club,
      athletes,
    };
  }

  async getAthleteSummary(eventId: number, athleteId: number, orderBy: SummaryOrderBy) {
    const scope = await this.resolveEventScope(eventId);
    await this.ensureEvent(scope.canonicalEventId);

    const athlete = await this.prisma.athlete.findFirst({
      where: {
        id: athleteId,
        eventId: { in: scope.allEventIds },
      },
      include: {
        club: true,
        categories: {
          include: {
            category: true,
          },
        },
      },
    });

    if (!athlete) {
      throw new NotFoundException("Atleta nao encontrado");
    }

    const matches = await this.prisma.match.findMany({
      where: {
        eventId: { in: scope.allEventIds },
        participants: {
          some: { athleteId },
        },
      },
      include: {
        event: true,
        category: true,
        participants: {
          include: {
            athlete: {
              include: {
                club: true,
              },
            },
          },
        },
      },
    });

    const matchSummaries = matches
      .map((match) => this.buildAthleteSummaryMatch(match, athleteId))
      .filter((match): match is AthleteSummaryMatch => Boolean(match));

    const normalizedOrderBy: SummaryOrderBy =
      orderBy === "category_phase_datetime" ? "category_phase_datetime" : "phase_hierarchy_datetime";

    const deduplicated = this.deduplicateMatches(matchSummaries);
    this.sortMatches(deduplicated.matches, normalizedOrderBy);

    const performance = calculateAthletePointPerformance(
      deduplicated.matches.map((match) => this.toMatchPerformanceInput(match)),
      {
        athleteId,
        athleteName: athlete.nameDisplay,
        athleteNameNormalized: athlete.nameNormalized,
      },
    );
    const categoryMatches = deduplicated.matches.map((match) => this.toCategoryAnalyticsMatch(match));
    const performanceByCategoryRaw = computeCategoryPerformanceSummaries(categoryMatches, {
      athleteId,
      athleteName: athlete.nameDisplay,
      athleteNameNormalized: athlete.nameNormalized,
    });
    const categoryIdsForClassification = [...new Set(performanceByCategoryRaw.map((item) => item.categoryId))];
    const fullCategoryMatchesRaw =
      categoryIdsForClassification.length > 0
        ? await this.prisma.match.findMany({
            where: {
              eventId: { in: scope.allEventIds },
              categoryId: {
                in: categoryIdsForClassification,
              },
            },
            include: {
              category: true,
              participants: {
                include: {
                  athlete: {
                    include: {
                      club: true,
                    },
                  },
                },
              },
            },
          })
        : [];
    const fullCategoryMatches = fullCategoryMatchesRaw
      .map((match) => this.buildCategoryAnalyticsMatchFromRaw(match))
      .filter((item): item is CategoryAnalyticsMatch => Boolean(item));

    const classificationByCategory = computeCategoryClassificationSummaries(fullCategoryMatches, {
      athleteId,
      athleteName: athlete.nameDisplay,
      athleteNameNormalized: athlete.nameNormalized,
    });
    const classificationMap = new Map<number, (typeof classificationByCategory)[number]>(
      classificationByCategory.map((item) => [item.categoryId, item]),
    );
    const performanceByCategory = performanceByCategoryRaw.map((item) => ({
      ...item,
      classification: classificationMap.get(item.categoryId) ?? null,
    }));
    const categoryNameById = new Map<number, string>();
    for (const item of athlete.categories) {
      const category = item.category;
      if (category.cbtmCategoryId && IGNORED_CATEGORY_IDS.includes(category.cbtmCategoryId)) {
        continue;
      }
      const suffix =
        category.eventId === scope.canonicalEventId
          ? ""
          : (scope.childSuffixByEventId.get(category.eventId) ?? " -X");
      categoryNameById.set(category.id, `${category.name}${suffix}`);
    }

    return {
      athlete: {
        id: athlete.id,
        name: athlete.nameDisplay,
        shortName: toReducedName(athlete.nameDisplay),
        athleteKey: normalizeAthleteName(athlete.nameDisplay),
        rankingPoints: athlete.rankingPoints,
        ratingPoints: athlete.ratingPoints,
        stateCode: athlete.stateCode,
        stateName: athlete.stateName,
        region: athlete.region,
      },
      club: {
        id: athlete.club.id,
        name: athlete.club.name,
      },
      categories: athlete.categories
        .map((item) => item.category)
        .filter((category) => !category.cbtmCategoryId || !IGNORED_CATEGORY_IDS.includes(category.cbtmCategoryId))
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }))
        .map((category) => ({
          id: category.id,
          name: categoryNameById.get(category.id) ?? category.name,
          cbtmCategoryId: category.cbtmCategoryId,
        })),
      matches: deduplicated.matches.map((match) => ({
        ...match,
        category: {
          ...match.category,
          name:
            categoryNameById.get(match.category.id) ??
            `${match.category.name}${scope.childSuffixByEventId.get(match.event.id) ?? ""}`,
        },
      })),
      performance,
      performanceByCategory: performanceByCategory.map((item) => ({
        ...item,
        categoryName: categoryNameById.get(item.categoryId) ?? item.categoryName,
      })),
      orderByApplied: normalizedOrderBy,
      deduplicatedMatchesRemoved: deduplicated.removed,
      noDatetimeFallback: "Jogos sem horario ficam no final da fase/rodada e sao desempatados por mesa e match_key.",
    };
  }

  async listAthleteDirectory(search: string): Promise<AthleteDirectoryRow[]> {
    const trimmedSearch = search.trim();
    const normalizedSearch = normalizeAthleteName(trimmedSearch);

    const athletes = await this.prisma.athlete.findMany({
      where: {
        createdFromWarning: false,
        nameDisplay: {
          contains: trimmedSearch || undefined,
          mode: "insensitive",
        },
      },
      select: {
        id: true,
        eventId: true,
        nameDisplay: true,
      },
      orderBy: [{ nameDisplay: "asc" }],
    });

    const grouped = new Map<
      string,
      {
        athleteKey: string;
        nameDisplay: string;
        eventIds: Set<number>;
        totalAthleteRecords: number;
      }
    >();

    for (const athlete of athletes) {
      const athleteKey = normalizeAthleteName(athlete.nameDisplay);
      if (!athleteKey) {
        continue;
      }
      if (normalizedSearch && !athleteKey.includes(normalizedSearch)) {
        continue;
      }

      const current = grouped.get(athleteKey);
      if (!current) {
        grouped.set(athleteKey, {
          athleteKey,
          nameDisplay: athlete.nameDisplay,
          eventIds: new Set([athlete.eventId]),
          totalAthleteRecords: 1,
        });
        continue;
      }

      current.totalAthleteRecords += 1;
      current.eventIds.add(athlete.eventId);
      if (athlete.nameDisplay.length > current.nameDisplay.length) {
        current.nameDisplay = athlete.nameDisplay;
      }
    }

    return [...grouped.values()]
      .map((entry) => ({
        athleteKey: entry.athleteKey,
        nameDisplay: entry.nameDisplay,
        nameReduced: toReducedName(entry.nameDisplay),
        firstLetter: toFirstLetter(entry.nameDisplay),
        totalEvents: entry.eventIds.size,
        totalAthleteRecords: entry.totalAthleteRecords,
      }))
      .sort((a, b) => a.nameDisplay.localeCompare(b.nameDisplay, "pt-BR", { sensitivity: "base" }));
  }

  async getAthleteCareer(athleteKey: string) {
    const normalizedKey = normalizeAthleteName(athleteKey);
    const legacyNormalizedKey = normalizeText(athleteKey);
    if (!normalizedKey) {
      throw new NotFoundException("Atleta nao encontrado");
    }

    const athletesByKey = await this.prisma.athlete.findMany({
      where: {
        createdFromWarning: false,
        OR: [
          { nameNormalized: normalizedKey },
          { nameNormalized: legacyNormalizedKey },
          {
            aliases: {
              some: {
                aliasNormalized: normalizedKey,
              },
            },
          },
        ],
      },
      include: {
        aliases: true,
      },
      orderBy: [{ nameDisplay: "asc" }],
    });

    const fallbackAthletes =
      athletesByKey.length > 0
        ? athletesByKey
        : await this.prisma.athlete.findMany({
            where: {
              createdFromWarning: false,
              OR: [
                {
                  nameNormalized: {
                    contains: normalizedKey.split(" ")[0] ?? normalizedKey,
                    mode: "insensitive",
                  },
                },
                {
                  aliases: {
                    some: {
                      aliasNormalized: {
                        contains: normalizedKey.split(" ")[0] ?? normalizedKey,
                        mode: "insensitive",
                      },
                    },
                  },
                },
              ],
            },
            include: {
              aliases: true,
            },
            take: 300,
          });

    const athleteRecords = fallbackAthletes.filter((athlete) => {
      const normalizedDisplay = normalizeAthleteName(athlete.nameDisplay);
      const normalizedStored = normalizeAthleteName(athlete.nameNormalized);
      if (normalizedDisplay === normalizedKey) {
        return true;
      }
      if (normalizedStored === normalizedKey) {
        return true;
      }
      return athlete.aliases.some((alias) => normalizeAthleteName(alias.aliasNormalized) === normalizedKey);
    });

    if (athleteRecords.length === 0) {
      throw new NotFoundException("Atleta nao encontrado");
    }

    const canonicalName = athleteRecords.reduce((best, current) => {
      if (current.nameDisplay.length > best.length) {
        return current.nameDisplay;
      }
      return best;
    }, athleteRecords[0].nameDisplay);
    const federation = athleteRecords.find((item) => item.stateCode && item.region) ?? athleteRecords[0];

    const athleteIds = athleteRecords.map((athlete) => athlete.id);
    const matches = await this.prisma.match.findMany({
      where: {
        participants: {
          some: {
            athleteId: {
              in: athleteIds,
            },
          },
        },
      },
      include: {
        event: true,
        category: true,
        participants: {
          include: {
            athlete: {
              include: {
                club: true,
              },
            },
          },
        },
      },
    });

    const summaries: AthleteSummaryMatch[] = [];
    for (const match of matches) {
      const participantIds = match.participants.map((participant) => participant.athleteId);
      const matchedAthleteIds = participantIds.filter((id) => athleteIds.includes(id));
      if (matchedAthleteIds.length === 0) {
        continue;
      }

      const primaryAthleteId = [...matchedAthleteIds].sort((a, b) => a - b)[0];
      const summary = this.buildAthleteSummaryMatch(match, primaryAthleteId);
      if (!summary) {
        continue;
      }
      summaries.push(summary);
    }

    const deduplicated = this.deduplicateMatches(summaries);
    this.sortMatches(deduplicated.matches, "phase_hierarchy_datetime");

    const eventBuckets = new Map<
      number,
      {
        event: AthleteSummaryMatch["event"];
        categories: Map<number, { id: number; name: string }>;
        matches: AthleteSummaryMatch[];
      }
    >();

    for (const match of deduplicated.matches) {
      const bucket = eventBuckets.get(match.event.id) ?? {
        event: match.event,
        categories: new Map<number, { id: number; name: string }>(),
        matches: [],
      };
      bucket.matches.push(match);
      bucket.categories.set(match.category.id, {
        id: match.category.id,
        name: match.category.name,
      });
      eventBuckets.set(match.event.id, bucket);
    }

    const events = (
      await Promise.all(
        [...eventBuckets.values()].map(async (bucket) => {
          const categoryIdsForClassification = [...bucket.categories.keys()];
          const fullCategoryMatchesRaw =
            categoryIdsForClassification.length > 0
              ? await this.prisma.match.findMany({
                  where: {
                    eventId: bucket.event.id,
                    categoryId: {
                      in: categoryIdsForClassification,
                    },
                  },
                  include: {
                    category: true,
                    participants: {
                      include: {
                        athlete: {
                          include: {
                            club: true,
                          },
                        },
                      },
                    },
                  },
                })
              : [];
          const fullCategoryMatches = fullCategoryMatchesRaw
            .map((match) => this.buildCategoryAnalyticsMatchFromRaw(match))
            .filter((item): item is CategoryAnalyticsMatch => Boolean(item));

          const categoryMatches = bucket.matches.map((match) => this.toCategoryAnalyticsMatch(match));
          const perf = computeCategoryPerformanceSummaries(categoryMatches, {
            athleteIds,
            athleteName: canonicalName,
            athleteNameNormalized: normalizedKey,
          });
          const classification = computeCategoryClassificationSummaries(fullCategoryMatches, {
            athleteIds,
            athleteName: canonicalName,
            athleteNameNormalized: normalizedKey,
          });
          const classificationMap = new Map<number, (typeof classification)[number]>(
            classification.map((item) => [item.categoryId, item]),
          );

          return {
            ...bucket.event,
            categories: [...bucket.categories.values()].sort((a, b) =>
              a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }),
            ),
            matches: bucket.matches,
            performance: calculateAthletePointPerformance(
              bucket.matches.map((match) => this.toMatchPerformanceInput(match)),
              {
                athleteIds,
                athleteName: canonicalName,
                athleteNameNormalized: normalizedKey,
              },
            ),
            performanceByCategory: perf.map((item) => ({
              ...item,
              classification: classificationMap.get(item.categoryId) ?? null,
            })),
          };
        }),
      )
    ).sort((a, b) => {
        const aTime = a.dataInicio ? new Date(a.dataInicio).getTime() : Number.MIN_SAFE_INTEGER;
        const bTime = b.dataInicio ? new Date(b.dataInicio).getTime() : Number.MIN_SAFE_INTEGER;
        if (aTime !== bTime) {
          return bTime - aTime;
        }
        return a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" });
      });

    const totalPerformance = calculateAthletePointPerformance(
      deduplicated.matches.map((match) => this.toMatchPerformanceInput(match)),
      {
        athleteIds,
        athleteName: canonicalName,
        athleteNameNormalized: normalizedKey,
      },
    );
    const medalTable = buildCareerMedalTable(events);

    return {
      athlete: {
        athleteKey: normalizedKey,
        nameDisplay: canonicalName,
        nameReduced: toReducedName(canonicalName),
        stateCode: federation.stateCode,
        stateName: federation.stateName,
        region: federation.region,
      },
      totals: {
        events: events.length,
        matches: deduplicated.matches.length,
        performance: totalPerformance,
      },
      medalTable,
      events,
      deduplicatedMatchesRemoved: deduplicated.removed,
    };
  }

  private buildAthleteSummaryMatch(match: MatchWithRelations, athleteId: number): AthleteSummaryMatch | null {
    const participants = match.participants.map((participant) => participant.athlete);
    const ordered = this.resolveOrderedPlayers(match.scorePlayers, participants);

    const athleteIndex =
      ordered.players[0]?.id === athleteId ? 0 : ordered.players[1]?.id === athleteId ? 1 : null;

    if (athleteIndex === null && !participants.some((participant) => participant.id === athleteId)) {
      return null;
    }

    const athletePlayer = athleteIndex === 0 ? ordered.players[0] : athleteIndex === 1 ? ordered.players[1] : null;
    const opponentPlayer = athleteIndex === 0 ? ordered.players[1] : athleteIndex === 1 ? ordered.players[0] : null;

    const sets = this.parseSetsJson(match.setsJson);
    const scoreSets = this.parseScoreSetsJson(match.scoreSets, sets, match.scoreRaw);
    const effectiveSets = scoreSets.map((set) => ({
      p1: set.a,
      p2: set.b,
    }));
    const legacySetsResult = this.resolveSetsResult(match.p1Sets, match.p2Sets, match.scoreRaw, effectiveSets);
    const scoreFinal = this.parseScoreFinalJson(match.scoreFinal, legacySetsResult);
    const setsResult = scoreFinal
      ? {
          p1Sets: scoreFinal.setsA,
          p2Sets: scoreFinal.setsB,
        }
      : legacySetsResult;
    const winnerIndex = this.resolveWinnerIndexFromData({
      storedWinnerIndex: match.winnerIndex,
      setsResult,
      sets: effectiveSets,
      hasReliableOrder: ordered.hasReliableOrder,
    });

    return {
      id: match.id,
      event: {
        id: match.event.id,
        cbtmEventId: match.event.cbtmEventId,
        nome: match.event.nome,
        nivel: match.event.nivel,
        dataInicio: match.event.dataInicio,
        dataFim: match.event.dataFim,
        concluido: match.event.concluido,
      },
      phase: match.phase,
      round: match.round,
      tableNumber: match.tableNumber,
      matchDatetime: match.matchDatetime,
      scoreRaw: match.scoreRaw,
      scoreFinal,
      scoreSets,
      sets: effectiveSets,
      setsResult,
      winnerIndex,
      athleteIndex,
      outcome: getAthleteMatchOutcome({ winnerIndex, athleteIndex }),
      sourceUrl: match.sourceUrl,
      players: ordered.players,
      category: {
        id: match.category.id,
        name: match.category.name,
        cbtmCategoryId: match.category.cbtmCategoryId,
      },
      matchKey: match.matchKey,
      gameId: this.extractGameIdFromRound(match.round),
      athlete:
        athletePlayer && athletePlayer.id
          ? {
              id: athletePlayer.id,
              name: athletePlayer.name,
            }
          : null,
      athleteKey: athletePlayer ? normalizeAthleteName(athletePlayer.name) : null,
      opponent:
        opponentPlayer && opponentPlayer.id
          ? {
              id: opponentPlayer.id,
              name: opponentPlayer.name,
              club: opponentPlayer.club,
            }
          : null,
    };
  }

  private parseScorePlayers(raw: Prisma.JsonValue | null):
    | [{ athleteId: number | null; name: string | null }, { athleteId: number | null; name: string | null }]
    | null {
    if (!Array.isArray(raw) || raw.length < 2) {
      return null;
    }

    const hints = raw.slice(0, 2).map((item) => {
      if (!item || typeof item !== "object") {
        return { athleteId: null, name: null };
      }

      const value = item as { athleteId?: unknown; name?: unknown };
      const athleteId = Number.isInteger(value.athleteId) ? Number(value.athleteId) : null;
      const name = typeof value.name === "string" && value.name.trim() ? value.name.trim() : null;

      return {
        athleteId,
        name,
      };
    });

    return [hints[0], hints[1]];
  }

  private toSummaryPlayer(
    athlete: MatchWithRelations["participants"][number]["athlete"] | null,
    fallbackName?: string | null,
  ): AthleteSummaryPlayer | null {
    if (!athlete && !fallbackName) {
      return null;
    }

    if (!athlete) {
      return {
        id: null,
        name: fallbackName ?? "Sem atleta",
        club: null,
      };
    }

    return {
      id: athlete.id,
      name: athlete.nameDisplay,
      club: athlete.club ? { id: athlete.club.id, name: athlete.club.name } : null,
    };
  }

  private resolveOrderedPlayers(
    scorePlayersRaw: Prisma.JsonValue | null,
    participants: MatchWithRelations["participants"][number]["athlete"][],
  ): {
    players: [AthleteSummaryPlayer | null, AthleteSummaryPlayer | null];
    hasReliableOrder: boolean;
  } {
    const sortedParticipants = [...participants].sort((a, b) => a.id - b.id);
    const hints = this.parseScorePlayers(scorePlayersRaw);

    if (!hints) {
      return {
        players: [this.toSummaryPlayer(sortedParticipants[0] ?? null), this.toSummaryPlayer(sortedParticipants[1] ?? null)],
        hasReliableOrder: false,
      };
    }

    const remaining = [...sortedParticipants];
    const resolved: Array<MatchWithRelations["participants"][number]["athlete"] | null> = [null, null];
    let resolvedFromHints = 0;

    for (let index = 0; index < 2; index += 1) {
      const hint = hints[index];
      let foundIndex = -1;

      if (typeof hint.athleteId === "number") {
        foundIndex = remaining.findIndex((participant) => participant.id === hint.athleteId);
      }

      if (foundIndex === -1 && hint.name) {
        const normalizedHint = normalizeAthleteName(hint.name);
        foundIndex = remaining.findIndex(
          (participant) => normalizeAthleteName(participant.nameDisplay) === normalizedHint,
        );
      }

      if (foundIndex >= 0) {
        resolved[index] = remaining[foundIndex];
        remaining.splice(foundIndex, 1);
        resolvedFromHints += 1;
      }
    }

    for (let index = 0; index < 2; index += 1) {
      if (!resolved[index] && remaining.length > 0) {
        resolved[index] = remaining.shift() ?? null;
      }
    }

    return {
      players: [this.toSummaryPlayer(resolved[0], hints[0].name), this.toSummaryPlayer(resolved[1], hints[1].name)],
      hasReliableOrder: resolvedFromHints > 0,
    };
  }

  private parseSetsJson(raw: Prisma.JsonValue | null): Array<{ p1: number; p2: number }> {
    if (!Array.isArray(raw)) {
      return [];
    }

    const sets: Array<{ p1: number; p2: number }> = [];
    for (const item of raw) {
      if (!item || typeof item !== "object") {
        continue;
      }

      const row = item as { p1?: unknown; p2?: unknown };
      const p1 = Number(row.p1);
      const p2 = Number(row.p2);
      if (!Number.isFinite(p1) || !Number.isFinite(p2)) {
        continue;
      }
      if (p1 < 0 || p2 < 0) {
        continue;
      }

      sets.push({
        p1,
        p2,
      });
    }

    return sets;
  }

  private parseScoreSetsJson(
    raw: Prisma.JsonValue | null,
    fallbackSets: Array<{ p1: number; p2: number }>,
    scoreRaw: string,
  ): Array<{ set: number; a: number; b: number }> {
    if (Array.isArray(raw)) {
      const parsed: Array<{ set: number; a: number; b: number }> = [];
      for (const item of raw) {
        if (!item || typeof item !== "object") {
          continue;
        }

        const row = item as { set?: unknown; a?: unknown; b?: unknown };
        const set = Number(row.set);
        const a = Number(row.a);
        const b = Number(row.b);
        if (!Number.isFinite(a) || !Number.isFinite(b)) {
          continue;
        }
        if (a < 0 || b < 0) {
          continue;
        }

        parsed.push({
          set: Number.isFinite(set) && set > 0 ? Number(set) : parsed.length + 1,
          a,
          b,
        });
      }

      if (parsed.length > 0) {
        return parsed;
      }
    }

    if (fallbackSets.length > 0) {
      return fallbackSets.map((set, index) => ({
        set: index + 1,
        a: set.p1,
        b: set.p2,
      }));
    }

    return this.parseScoreSetsFromScoreRaw(scoreRaw);
  }

  private parseScoreSetsFromScoreRaw(scoreRaw: string | null | undefined): Array<{ set: number; a: number; b: number }> {
    const normalized = String(scoreRaw ?? "")
      .replace(/[\u2013\u2014\u2212]/g, "-")
      .replace(/\u00D7/g, "x");

    const parsePairs = (value: string): Array<{ a: number; b: number }> => {
      const pairs: Array<{ a: number; b: number }> = [];
      for (const match of value.matchAll(/(\d{1,2})\s*(?:-|\/|x|X)\s*(\d{1,2})/g)) {
        const a = Number(match[1]);
        const b = Number(match[2]);
        if (!Number.isFinite(a) || !Number.isFinite(b)) {
          continue;
        }
        pairs.push({ a, b });
      }
      return pairs;
    };

    const insideParentheses = [...normalized.matchAll(/\(([^)]*)\)/g)].map((match) => String(match[1] ?? ""));
    let pairs: Array<{ a: number; b: number }> = [];
    for (const chunk of insideParentheses) {
      pairs.push(...parsePairs(chunk));
    }
    if (pairs.length === 0) {
      pairs = parsePairs(normalized);
    }

    return pairs
      .filter((pair) => Math.max(pair.a, pair.b) >= 8 || (pair.a === 0 && pair.b === 0))
      .map((pair, index) => ({
        set: index + 1,
        a: pair.a,
        b: pair.b,
      }));
  }

  private parseScoreFinalJson(
    raw: Prisma.JsonValue | null,
    fallback: { p1Sets: number; p2Sets: number } | null,
  ): { setsA: number; setsB: number } | null {
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const value = raw as { setsA?: unknown; setsB?: unknown };
      const setsA = Number(value.setsA);
      const setsB = Number(value.setsB);

      if (Number.isFinite(setsA) && Number.isFinite(setsB)) {
        return {
          setsA,
          setsB,
        };
      }
    }

    if (!fallback) {
      return null;
    }

    return {
      setsA: fallback.p1Sets,
      setsB: fallback.p2Sets,
    };
  }

  private resolveSetsResult(
    p1Sets: number | null,
    p2Sets: number | null,
    scoreRaw: string,
    sets: Array<{ p1: number; p2: number }>,
  ): { p1Sets: number; p2Sets: number } | null {
    if (Number.isInteger(p1Sets) && Number.isInteger(p2Sets)) {
      return {
        p1Sets: Number(p1Sets),
        p2Sets: Number(p2Sets),
      };
    }

    const parsedFromRaw = parseSetsResultFromScoreRaw(scoreRaw);
    if (parsedFromRaw) {
      return parsedFromRaw;
    }

    if (sets.length > 0) {
      let p1Wins = 0;
      let p2Wins = 0;
      for (const set of sets) {
        if (set.p1 > set.p2) {
          p1Wins += 1;
        } else if (set.p2 > set.p1) {
          p2Wins += 1;
        }
      }
      if (p1Wins > 0 || p2Wins > 0) {
        return {
          p1Sets: p1Wins,
          p2Sets: p2Wins,
        };
      }
    }

    return null;
  }

  private resolveWinnerIndexFromData(input: {
    storedWinnerIndex: number | null;
    setsResult: { p1Sets: number; p2Sets: number } | null;
    sets: Array<{ p1: number; p2: number }>;
    hasReliableOrder: boolean;
  }): 0 | 1 | null {
    if (input.storedWinnerIndex === 0 || input.storedWinnerIndex === 1) {
      return input.storedWinnerIndex;
    }

    if (!input.hasReliableOrder) {
      return null;
    }

    if (input.setsResult) {
      if (input.setsResult.p1Sets > input.setsResult.p2Sets) {
        return 0;
      }
      if (input.setsResult.p2Sets > input.setsResult.p1Sets) {
        return 1;
      }
    }

    if (input.sets.length > 0) {
      let p1Wins = 0;
      let p2Wins = 0;
      for (const set of input.sets) {
        if (set.p1 > set.p2) {
          p1Wins += 1;
        } else if (set.p2 > set.p1) {
          p2Wins += 1;
        }
      }
      if (p1Wins > p2Wins) {
        return 0;
      }
      if (p2Wins > p1Wins) {
        return 1;
      }
    }

    return null;
  }

  private toMatchPerformanceInput(match: AthleteSummaryMatch): MatchPerformanceInput {
    return {
      players: [
        {
          athleteId: match.players[0]?.id ?? null,
          name: match.players[0]?.name ?? null,
        },
        {
          athleteId: match.players[1]?.id ?? null,
          name: match.players[1]?.name ?? null,
        },
      ],
      sets: match.sets,
      winnerIndex: match.winnerIndex,
    };
  }

  private toCategoryAnalyticsMatch(match: AthleteSummaryMatch): CategoryAnalyticsMatch {
    return {
      categoryId: match.category.id,
      categoryName: match.category.name,
      phase: match.phase,
      round: match.round,
      players: [
        {
          athleteId: match.players[0]?.id ?? null,
          name: match.players[0]?.name ?? null,
        },
        {
          athleteId: match.players[1]?.id ?? null,
          name: match.players[1]?.name ?? null,
        },
      ],
      sets: match.sets,
      setsResult: match.setsResult,
      winnerIndex: match.winnerIndex,
    };
  }

  private buildCategoryAnalyticsMatchFromRaw(match: MatchMinimalWithRelations): CategoryAnalyticsMatch | null {
    const participants = match.participants.map((participant) => participant.athlete);
    const ordered = this.resolveOrderedPlayers(match.scorePlayers, participants);
    if (!ordered.players[0] || !ordered.players[1]) {
      return null;
    }

    const sets = this.parseSetsJson(match.setsJson);
    const scoreSets = this.parseScoreSetsJson(match.scoreSets, sets, match.scoreRaw);
    const effectiveSets = scoreSets.map((set) => ({
      p1: set.a,
      p2: set.b,
    }));
    const legacySetsResult = this.resolveSetsResult(match.p1Sets, match.p2Sets, match.scoreRaw, effectiveSets);
    const scoreFinal = this.parseScoreFinalJson(match.scoreFinal, legacySetsResult);
    const setsResult = scoreFinal
      ? {
          p1Sets: scoreFinal.setsA,
          p2Sets: scoreFinal.setsB,
        }
      : legacySetsResult;
    const winnerIndex = this.resolveWinnerIndexFromData({
      storedWinnerIndex: match.winnerIndex,
      setsResult,
      sets: effectiveSets,
      hasReliableOrder: ordered.hasReliableOrder,
    });

    return {
      categoryId: match.category.id,
      categoryName: match.category.name,
      phase: match.phase,
      round: match.round,
      players: [
        {
          athleteId: ordered.players[0].id ?? null,
          name: ordered.players[0].name,
        },
        {
          athleteId: ordered.players[1].id ?? null,
          name: ordered.players[1].name,
        },
      ],
      sets: effectiveSets,
      setsResult,
      winnerIndex,
    };
  }

  private sortMatches(matches: AthleteSummaryMatch[], orderBy: SummaryOrderBy): void {
    matches.sort((a, b) => {
      if (orderBy === "category_phase_datetime") {
        const byCategory = a.category.name.localeCompare(b.category.name, "pt-BR", { sensitivity: "base" });
        if (byCategory !== 0) {
          return byCategory;
        }
      }

      const byHierarchy = this.getRoundHierarchyOrder(a.round, a.phase) - this.getRoundHierarchyOrder(b.round, b.phase);
      if (byHierarchy !== 0) {
        return byHierarchy;
      }

      const byRound = getRoundSemanticOrder(a.round ?? null) - getRoundSemanticOrder(b.round ?? null);
      if (byRound !== 0) {
        return byRound;
      }

      const byPhase = getMatchPhaseOrder(a.phase) - getMatchPhaseOrder(b.phase);
      if (byPhase !== 0) {
        return byPhase;
      }

      const timestampA = a.matchDatetime ? new Date(a.matchDatetime).getTime() : Number.MAX_SAFE_INTEGER;
      const timestampB = b.matchDatetime ? new Date(b.matchDatetime).getTime() : Number.MAX_SAFE_INTEGER;
      if (timestampA !== timestampB) {
        return timestampA - timestampB;
      }

      const tableA = Number.isFinite(Number(a.tableNumber)) ? Number(a.tableNumber) : Number.MAX_SAFE_INTEGER;
      const tableB = Number.isFinite(Number(b.tableNumber)) ? Number(b.tableNumber) : Number.MAX_SAFE_INTEGER;
      if (tableA !== tableB) {
        return tableA - tableB;
      }

      return a.matchKey.localeCompare(b.matchKey);
    });
  }

  private deduplicateMatches(matches: AthleteSummaryMatch[]): { matches: AthleteSummaryMatch[]; removed: number } {
    const firstPass = this.deduplicateByKey(matches, (match) => {
      const day = this.getMatchDay(match.matchDatetime);
      if (!day || !match.gameId) {
        return null;
      }

      return [match.category.id, this.getParticipantKey(match), day, `game:${match.gameId}`].join("|");
    });

    const secondPass = this.deduplicateByKey(firstPass.matches, (match) => {
      const timestamp = this.getMatchTimestamp(match.matchDatetime);
      if (!timestamp) {
        return null;
      }

      return [
        match.category.id,
        this.getParticipantKey(match),
        timestamp,
        match.tableNumber ?? "sem-mesa",
        match.scoreRaw,
      ].join("|");
    });

    return {
      matches: secondPass.matches,
      removed: firstPass.removed + secondPass.removed,
    };
  }

  private deduplicateByKey(
    matches: AthleteSummaryMatch[],
    buildKey: (match: AthleteSummaryMatch) => string | null,
  ): { matches: AthleteSummaryMatch[]; removed: number } {
    const map = new Map<string, AthleteSummaryMatch>();

    for (const match of matches) {
      const key = buildKey(match) ?? `match:${match.id}`;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, match);
        continue;
      }

      map.set(key, this.selectPreferredMatch(existing, match));
    }

    return {
      matches: [...map.values()],
      removed: matches.length - map.size,
    };
  }

  private selectPreferredMatch(a: AthleteSummaryMatch, b: AthleteSummaryMatch): AthleteSummaryMatch {
    if (a.sets.length !== b.sets.length) {
      return a.sets.length > b.sets.length ? a : b;
    }

    const specificityA = this.getRoundSpecificity(a.round);
    const specificityB = this.getRoundSpecificity(b.round);
    if (specificityA !== specificityB) {
      return specificityA > specificityB ? a : b;
    }

    const hierarchyA = this.getRoundHierarchyOrder(a.round, a.phase);
    const hierarchyB = this.getRoundHierarchyOrder(b.round, b.phase);
    if (hierarchyA !== hierarchyB) {
      return hierarchyA < hierarchyB ? a : b;
    }

    const hasDatetimeA = Boolean(a.matchDatetime);
    const hasDatetimeB = Boolean(b.matchDatetime);
    if (hasDatetimeA !== hasDatetimeB) {
      return hasDatetimeA ? a : b;
    }

    const roundOrderA = getRoundSemanticOrder(a.round ?? null);
    const roundOrderB = getRoundSemanticOrder(b.round ?? null);
    if (roundOrderA !== roundOrderB) {
      return roundOrderA < roundOrderB ? a : b;
    }

    return a.id <= b.id ? a : b;
  }

  private getParticipantKey(match: AthleteSummaryMatch): string {
    const playerTokens = match.players
      .map((player, index) => {
        if (player?.id) {
          return `id:${player.id}`;
        }
        return `nm:${normalizeAthleteName(player?.name ?? `p${index + 1}`)}`;
      })
      .sort();

    return playerTokens.join("|");
  }

  private getRoundSpecificity(round: string | null | undefined): number {
    const normalized = (round ?? "").toString().toLowerCase();
    if (!normalized) {
      return 0;
    }

    if (
      normalized.includes("fase") ||
      normalized.includes("grupo") ||
      normalized.includes("oitavas") ||
      normalized.includes("quartas") ||
      normalized.includes("semi") ||
      normalized.includes("final") ||
      /\b1\/\d+\b/.test(normalized)
    ) {
      return 3;
    }

    if (normalized.includes("jogo")) {
      return 2;
    }

    if (normalized.includes("rodada")) {
      return 1;
    }

    return 0;
  }

  private getRoundHierarchyOrder(round: string | null | undefined, phase: string | null | undefined): number {
    const normalized = (round ?? "").toString().toLowerCase();

    if (normalized.includes("grupo")) {
      return 10;
    }
    if (/\b32\b/.test(normalized) || normalized.includes("1/32")) {
      return 20;
    }
    if (/\b16\b/.test(normalized) || normalized.includes("1/16")) {
      return 30;
    }
    if (normalized.includes("oitavas")) {
      return 40;
    }
    if (normalized.includes("quartas")) {
      return 50;
    }
    if (normalized.includes("semi")) {
      return 60;
    }
    if (normalized.includes("final")) {
      return 70;
    }

    const phaseOrder = getMatchPhaseOrder(phase ?? null);
    if (phaseOrder === 1) {
      return 10;
    }
    if (phaseOrder === 2) {
      return 80;
    }
    if (phaseOrder === 3) {
      return 90;
    }
    if (phaseOrder === 4) {
      return 100;
    }

    return 999;
  }

  private extractGameIdFromRound(round: string | null | undefined): string | null {
    const normalized = (round ?? "").toString().toLowerCase();
    if (!normalized) {
      return null;
    }

    const explicit = normalized.match(/\b(?:jogo|fase|rodada)\s*0*(\d+)\b/);
    if (explicit?.[1]) {
      return String(Number(explicit[1]));
    }

    const slash = normalized.match(/\b1\/(\d+)\b/);
    if (slash?.[1]) {
      return String(Number(slash[1]));
    }

    const group = normalized.match(/\bgrupo\s*0*(\d+)\b/);
    if (group?.[1]) {
      return `g${Number(group[1])}`;
    }

    if (normalized.includes("oitavas")) {
      return "8";
    }
    if (normalized.includes("quartas")) {
      return "4";
    }
    if (normalized.includes("semi")) {
      return "2";
    }
    if (normalized.includes("final")) {
      return "1";
    }
    if (normalized.includes("grupo")) {
      return "grupo";
    }

    return null;
  }

  private getMatchDay(matchDatetime: Date | null): string | null {
    if (!matchDatetime) {
      return null;
    }
    return matchDatetime.toISOString().slice(0, 10);
  }

  private getMatchTimestamp(matchDatetime: Date | null): string | null {
    if (!matchDatetime) {
      return null;
    }
    return matchDatetime.toISOString();
  }

  private normalizeGroupRoundKey(round: string | null | undefined): string | null {
    const normalized = normalizeAthleteName(round ?? "");
    if (!normalized || !normalized.includes("grupo")) {
      return null;
    }

    const number = normalized.match(/grupo\s*(\d+)/)?.[1] ?? null;
    if (number) {
      return `grupo-${Number(number)}`;
    }
    return normalized;
  }

  private async inferHistoricalGroupPreferences(input: {
    eventId: number;
    categories: Array<{ id: number; normalizedName: string }>;
    athleteCountByCategory: Map<number, number>;
  }): Promise<Map<number, { preferredGroupCount: number | null; sampleSize: number }>> {
    const result = new Map<number, { preferredGroupCount: number | null; sampleSize: number }>();
    if (input.categories.length === 0) {
      return result;
    }

    const normalizedNames = [...new Set(input.categories.map((category) => category.normalizedName))];

    const historicalCategories = await this.prisma.category.findMany({
      where: {
        eventId: { not: input.eventId },
        normalizedName: { in: normalizedNames },
      },
      select: {
        id: true,
        normalizedName: true,
      },
      take: 300,
    });

    const historicalCategoryIds = historicalCategories.map((item) => item.id);
    if (historicalCategoryIds.length === 0) {
      for (const category of input.categories) {
        result.set(category.id, { preferredGroupCount: null, sampleSize: 0 });
      }
      return result;
    }

    const historicalNameByCategoryId = new Map<number, string>();
    for (const item of historicalCategories) {
      historicalNameByCategoryId.set(item.id, item.normalizedName);
    }

    const [athleteCounts, groupMatches] = await Promise.all([
      this.prisma.athleteCategory.groupBy({
        by: ["categoryId"],
        where: { categoryId: { in: historicalCategoryIds } },
        _count: { athleteId: true },
      }),
      this.prisma.match.findMany({
        where: {
          categoryId: { in: historicalCategoryIds },
          phase: "GRUPOS",
        },
        select: {
          categoryId: true,
          round: true,
        },
      }),
    ]);

    const athleteCountByHistoricalCategory = new Map<number, number>();
    for (const row of athleteCounts) {
      athleteCountByHistoricalCategory.set(row.categoryId, row._count.athleteId);
    }

    const groupsByCategory = new Map<number, Set<string>>();
    for (const match of groupMatches) {
      const roundKey = this.normalizeGroupRoundKey(match.round);
      if (!roundKey) {
        continue;
      }
      const bucket = groupsByCategory.get(match.categoryId) ?? new Set<string>();
      bucket.add(roundKey);
      groupsByCategory.set(match.categoryId, bucket);
    }

    const samplesByNormalizedName = new Map<string, Array<{ athleteCount: number; groupCount: number }>>();
    for (const [historicalCategoryId, groups] of groupsByCategory.entries()) {
      const normalizedName = historicalNameByCategoryId.get(historicalCategoryId);
      if (!normalizedName) {
        continue;
      }
      const athleteCount = athleteCountByHistoricalCategory.get(historicalCategoryId) ?? 0;
      const groupCount = groups.size;
      if (athleteCount <= 0 || groupCount <= 0) {
        continue;
      }
      const samples = samplesByNormalizedName.get(normalizedName) ?? [];
      samples.push({ athleteCount, groupCount });
      samplesByNormalizedName.set(normalizedName, samples);
    }

    for (const category of input.categories) {
      const targetAthleteCount = input.athleteCountByCategory.get(category.id) ?? 0;
      const samples = samplesByNormalizedName.get(category.normalizedName) ?? [];
      if (samples.length === 0 || targetAthleteCount <= 0) {
        result.set(category.id, { preferredGroupCount: null, sampleSize: samples.length });
        continue;
      }

      samples.sort((a, b) => {
        const diffA = Math.abs(a.athleteCount - targetAthleteCount);
        const diffB = Math.abs(b.athleteCount - targetAthleteCount);
        if (diffA !== diffB) {
          return diffA - diffB;
        }
        return Math.abs(a.groupCount - b.groupCount);
      });

      result.set(category.id, {
        preferredGroupCount: samples[0].groupCount,
        sampleSize: samples.length,
      });
    }

    for (const category of input.categories) {
      if (!result.has(category.id)) {
        result.set(category.id, { preferredGroupCount: null, sampleSize: 0 });
      }
    }

    return result;
  }

  private async loadEventMerges(): Promise<EventMergeEntry[]> {
    const now = Date.now();
    if (this.eventMergeCache && this.eventMergeCache.expiresAt > now) {
      return this.eventMergeCache.entries;
    }

    const rows = await this.prisma.eventMerge.findMany({
      select: {
        id: true,
        primaryEventId: true,
        secondaryEventId: true,
        categorySuffix: true,
      },
    });
    const entries = rows.map((row) => ({
      id: row.id,
      primaryEventId: row.primaryEventId,
      secondaryEventId: row.secondaryEventId,
      categorySuffix: (row.categorySuffix?.trim() || "-X").startsWith("-")
        ? ` ${row.categorySuffix.trim()}`
        : row.categorySuffix?.trim() || " -X",
    }));

    this.eventMergeCache = {
      expiresAt: now + UserService.EFFICIENCY_CACHE_TTL_MS,
      entries,
    };
    return entries;
  }

  private async resolveEventScope(eventId: number): Promise<EventScope> {
    const merges = await this.loadEventMerges();
    const secondaryToPrimary = new Map<number, number>();
    for (const merge of merges) {
      secondaryToPrimary.set(merge.secondaryEventId, merge.primaryEventId);
    }

    const canonicalEventId = secondaryToPrimary.get(eventId) ?? eventId;
    const childEntries = merges.filter((merge) => merge.primaryEventId === canonicalEventId);
    const childSuffixByEventId = new Map<number, string>();
    for (const entry of childEntries) {
      childSuffixByEventId.set(entry.secondaryEventId, entry.categorySuffix || " -X");
    }

    const allEventIds = [canonicalEventId, ...childEntries.map((entry) => entry.secondaryEventId)];
    return {
      canonicalEventId,
      allEventIds,
      childSuffixByEventId,
    };
  }

  private async resolveEventScopeByCanonical(canonicalEventId: number): Promise<EventScope> {
    const merges = await this.loadEventMerges();
    const childEntries = merges.filter((merge) => merge.primaryEventId === canonicalEventId);
    const childSuffixByEventId = new Map<number, string>();
    for (const entry of childEntries) {
      childSuffixByEventId.set(entry.secondaryEventId, entry.categorySuffix || " -X");
    }

    return {
      canonicalEventId,
      allEventIds: [canonicalEventId, ...childEntries.map((entry) => entry.secondaryEventId)],
      childSuffixByEventId,
    };
  }

  private async eventHasOfficialGroups(eventIds: number[]): Promise<boolean> {
    const groupMatch = await this.prisma.match.findFirst({
      where: {
        eventId: { in: eventIds },
        OR: [{ phase: "GRUPOS" }, { round: { contains: "grupo", mode: "insensitive" } }],
      },
      select: {
        id: true,
        phase: true,
        round: true,
      },
    });

    if (!groupMatch) {
      return false;
    }

    return hasGroupStructureFromMatch({
      phase: groupMatch.phase,
      round: groupMatch.round,
    });
  }

  private async readEventPublicationFlags(eventIds: number[]): Promise<{
    hasPublishedMatches: boolean;
    hasPublishedResults: boolean;
  }> {
    const scheduledPhases: Array<"GRUPOS" | "RESULTADOS" | "ELIMINATORIA"> = [
      "GRUPOS",
      "RESULTADOS",
      "ELIMINATORIA",
    ];

    const [publishedMatch, publishedResult] = await Promise.all([
      this.prisma.match.findFirst({
        where: {
          eventId: { in: eventIds },
          phase: { in: scheduledPhases },
        },
        select: { id: true },
      }),
      this.prisma.match.findFirst({
        where: {
          eventId: { in: eventIds },
          phase: { in: scheduledPhases },
          OR: [{ winnerIndex: { not: null } }, { p1Sets: { not: null } }, { p2Sets: { not: null } }],
        },
        select: { id: true },
      }),
    ]);

    return {
      hasPublishedMatches: Boolean(publishedMatch),
      hasPublishedResults: Boolean(publishedResult),
    };
  }

  private async getEfficiencyWeights() {
    let config:
      | {
          pesoOuro: number;
          pesoPrata: number;
          pesoBronze: number;
        }
      | null = null;

    try {
      const prismaWithEfficiency = this.prisma as unknown as {
        efficiencyConfig?: {
          findUnique?: (args: {
            where: { id: number };
            select: {
              pesoOuro: boolean;
              pesoPrata: boolean;
              pesoBronze: boolean;
            };
          }) => Promise<{
            pesoOuro: number;
            pesoPrata: number;
            pesoBronze: number;
          } | null>;
        };
      };

      config = await prismaWithEfficiency.efficiencyConfig?.findUnique?.({
        where: { id: 1 },
        select: {
          pesoOuro: true,
          pesoPrata: true,
          pesoBronze: true,
        },
      }) ?? null;
    } catch {
      config = null;
    }

    if (!config) {
      return DEFAULT_EFFICIENCY_WEIGHTS;
    }

    return {
      pesoOuro: config.pesoOuro,
      pesoPrata: config.pesoPrata,
      pesoBronze: config.pesoBronze,
    };
  }

  private async ensureEvent(eventId: number) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) {
      throw new NotFoundException("Evento nao encontrado");
    }
    return event;
  }

  private async ensureCategoryOfEvent(eventIds: number[], categoryId: number) {
    const category = await this.prisma.category.findFirst({
      where: {
        id: categoryId,
        eventId: { in: eventIds },
        OR: [{ cbtmCategoryId: null }, { cbtmCategoryId: { notIn: IGNORED_CATEGORY_IDS } }],
      },
      select: { id: true },
    });

    if (!category) {
      throw new NotFoundException("Categoria nao encontrada para o evento");
    }

    return category;
  }
}
