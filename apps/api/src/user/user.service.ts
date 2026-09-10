import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  buildEventScrapePolicy,
  computeEventCacheMaxAgeMs,
  compactWhitespace,
  EventSituation,
  MatchPerformanceInput,
  SummaryOrderBy,
  calculateAthletePointPerformance,
  computeOfficialCategoryMatchesCount,
  computeEventSituation,
  detectWalkover,
  getAthleteMatchOutcome,
  getMatchPhaseOrder,
  getRoundSemanticOrder,
  normalizeLegacyMatchPhase,
  normalizeAthleteName,
  normalizeText,
  normalizeRegistrationScope,
  resolveEventCacheTimingFromEnv,
  resolveEventScrapeIntervalOverridesFromEnv,
  resolveScrapeLockStaleMsFromEnv,
  type RegistrationScope,
} from "@cbtm/shared";
import { Prisma } from "@prisma/client";
import { PrismaReadService, PrismaService } from "../common/prisma.service";
import { loadCbtmRulesConfig } from "../rules/cbtm-config-loader";
import {
  collectWalkoverLoserAthleteIds,
  computeCategoryClassificationSummaries,
  inferCategoryMedalExpectation,
  computeCategoryPerformanceSummaries,
  type CategoryAnalyticsMatch,
} from "./athlete-analytics";
import { buildCareerMedalTable } from "./career-medals";
import { normalizeCategoryMedalists } from "./podium-normalizer";
import {
  canUseGroupSimulation,
  hasGroupStructureFromMatch,
  resolveUserEventStatus,
} from "./event-group-eligibility";
import { simulateGroupsForCategory } from "./group-simulator";
import {
  isResolvedSchedulePlayer,
  publishReadModelPayload,
  type ReadModelPublishMode,
} from "./read-model-mirror";
import { getReadModelPublishMode } from "./read-model-publish-context";
import {
  computeRegistrationBreakdown,
  hasMinimumSimulationAthletes,
  selectAthletesByRegistrationScope,
  type RegistrationBreakdown,
  type SimulationAthleteLink,
} from "./group-simulation-scope";

const TECHNICIAN_CATEGORY_ID = "88888888";
const GENERAL_TOTALIZER_CATEGORY_ID = "99999999";
const IGNORED_CATEGORY_IDS = [TECHNICIAN_CATEGORY_ID, GENERAL_TOTALIZER_CATEGORY_ID];
const SUPPORT_EMAIL = "gemaqueflores@gmail.com";
const DEFAULT_EFFICIENCY_WEIGHTS = {
  pesoOuro: 130,
  pesoPrata: 80,
  pesoBronze: 50,
} as const;
const DEFAULT_USER_LIST_PAGE_SIZE = Number(process.env.USER_LIST_DEFAULT_PAGE_SIZE ?? "500");
const MAX_USER_LIST_PAGE_SIZE = Number(process.env.USER_LIST_MAX_PAGE_SIZE ?? "2000");
const SCRAPE_INTERVAL_BY_SITUATION_MS = resolveEventScrapeIntervalOverridesFromEnv(process.env);
const SCRAPE_CACHE_TIMING = resolveEventCacheTimingFromEnv(process.env);
const SCRAPE_LOCK_STALE_MS = resolveScrapeLockStaleMsFromEnv(process.env);
const STATE_CIRCUIT_EVENT_LEVELS = ["ESTADUAL", "OPEN"] as const;
const STATE_CIRCUIT_ELIGIBILITY_CACHE_TTL_MS = Number(
  process.env.STATE_CIRCUIT_ELIGIBILITY_CACHE_TTL_MS ?? "300000",
);
const CBTM_RULES_CONFIG = loadCbtmRulesConfig();

type PaginationWindow = {
  skip: number;
  take: number;
};

type ReadModelPayload = Record<string, unknown> & {
  _meta?: {
    building?: boolean;
    publishedAt?: string;
    publishDecision?: string;
  };
  publishedAt?: string;
};

type EventAthleteSnapshotItem = {
  id: number;
  rawAthleteId: number;
  eventId: number;
  nameDisplay: string;
  nameNormalized: string;
  stateCode: string | null;
  region: string | null;
  club: { id: number; name: string; normalizedName?: string | null } | null;
};

type EventAthletesSnapshot = ReadModelPayload & {
  eventId: number;
  items: EventAthleteSnapshotItem[];
};

type EventClubAthleteSnapshotItem = EventAthleteSnapshotItem & {
  categoryIds: number[];
  categoryNames: string[];
};

type EventClubSnapshotItem = {
  id: number;
  name: string;
  normalizedName: string | null;
  athletes: EventClubAthleteSnapshotItem[];
};

type EventClubsSnapshot = ReadModelPayload & {
  eventId: number;
  clubs: EventClubSnapshotItem[];
};

type EventCategoriesSnapshot = ReadModelPayload & {
  eventId: number;
  items: Array<{
    id: number;
    eventId: number;
    name: string;
    normalizedName: string;
    cbtmCategoryId: string | null;
  }>;
};

type EventScheduleSnapshot = ReadModelPayload & {
  eventId: number;
  categories: Array<{
    categoryId: number;
    categoryName: string;
    matches: Array<{
      id: number;
      matchKey: string;
      round: string | null;
      tableNumber: string | null;
      matchDatetime: string | null;
      scoreRaw: string | null;
      playerA: { id: number | null; name: string; clubName: string | null } | null;
      playerB: { id: number | null; name: string; clubName: string | null } | null;
      preservedFromPublishedAt?: string;
    }>;
  }>;
};

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
  isProjectedParticipant?: boolean;
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
  unitKey?: string | null;
};

type EfficiencyEventMedalist = EfficiencyHistoryMedalist;

type EfficiencyWeights = {
  pesoOuro: number;
  pesoPrata: number;
  pesoBronze: number;
};

type EfficiencyConfigVersionLike = EfficiencyWeights & {
  dataInicioVigencia: Date;
  dataFimVigencia: Date | null;
};

type EfficiencyEventLevel = "ESTADUAL" | "COPA" | "NACIONAL" | "OPEN" | null;

type EventCategoryMedalist = {
  athleteId: number;
  athleteName: string;
  clubName: string | null;
  position: number;
  medalha: "ouro" | "prata" | "bronze";
  unitKey?: string | null;
};

type EventCategoryMedalistRow = {
  categoryId: number;
  categoryName: string;
  athleteCount: number;
  officialRegisteredCount: number | null;
  officialPreRegisteredCount: number | null;
  officialTotalListedCount: number | null;
  expectedMedalists: number | null;
  publishedMatchesCount: number;
  calculatedMatchesCount: number;
  walkoverMatchesCount: number;
  playedMatchesCount: number;
  medalists: EventCategoryMedalist[];
  diagnostics?: EventCategoryMedalistDiagnostics;
};

type EventCategoryMedalistDiagnostics = {
  status:
    | "ok"
    | "sem_atletas"
    | "sem_confrontos_publicados"
    | "classificacao_pendente_ou_indefinida"
    | "medalhistas_incompletos";
  message: string;
};

export function buildEventCategoryMedalistDiagnostics(input: {
  athleteCount: number;
  publishedMatchesCount: number;
  medalistsCount: number;
  expectedMedalists: number | null;
}): EventCategoryMedalistDiagnostics {
  if (input.athleteCount === 0) {
    return {
      status: "sem_atletas",
      message: "Categoria sem atletas vinculados.",
    };
  }
  if (input.publishedMatchesCount === 0) {
    return {
      status: "sem_confrontos_publicados",
      message: "Categoria sem confrontos publicados.",
    };
  }
  if (input.medalistsCount === 0) {
    return {
      status: "classificacao_pendente_ou_indefinida",
      message: "Confrontos publicados, mas a classificacao final ainda nao pode ser determinada.",
    };
  }
  if (
    typeof input.expectedMedalists === "number" &&
    input.expectedMedalists > 0 &&
    input.medalistsCount < input.expectedMedalists
  ) {
    return {
      status: "medalhistas_incompletos",
      message: `Encontrados ${input.medalistsCount} de ${input.expectedMedalists} medalhistas esperados.`,
    };
  }
  return {
    status: "ok",
    message: "Categoria com medalhistas definidos.",
  };
}

type CategoryAthleteRef = {
  athleteId: number;
  athleteName: string;
  clubId: number | null;
  clubName: string | null;
};

type CompetitiveEntryRef = CategoryAthleteRef;

type OfficialCategoryAuditRow = {
  categoryId: string;
  categoryName: string;
  valid: boolean;
  registeredCount: number | null;
  preRegisteredCount: number | null;
  totalListedCount: number | null;
  officialMatchesCount: number | null;
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

type EventRegistrationMetrics = {
  athleteCategoryAssociationsByEvent: Map<number, number>;
  tecnicoClubAssociationsByEvent: Map<number, number>;
  participantNamesByEvent: Map<number, Set<string>>;
};

type OfficialRegistrationTotals = {
  totalListed: number;
  totalRegistered: number;
  totalMatches: number;
};

type EventOfficialRules = {
  startDate: Date | null;
  ratingMatchFormat: "RR_K1" | "K1";
  competitionFormat: "AUTO" | "K1";
};

type ScopedEventSummaryInput = {
  id: number;
  lastScrapeAt: Date | null;
  dataInicio: Date | null;
  inicioRealizacao: Date | null;
  ratingMatchFormat: "RR_K1" | "K1" | null;
  competitionFormat: "AUTO" | "K1" | null;
};

type ScopedEventSummaryMetrics = {
  athleteCategoryAssociationsByEvent: Map<number, number>;
  tecnicoClubAssociationsByEvent: Map<number, number>;
  participantNamesByEvent: Map<number, Set<string>>;
  groupsDefinedByEventMap: Map<number, boolean>;
  publishedResultsByEventMap: Map<number, boolean>;
  effectiveCategoryCountByEvent: Map<number, number>;
  metricsByEventId: Map<number, { published: number; calculated: number; wo: number; played: number }>;
  calibratedByEventId: Map<number, boolean>;
  officialTotalsByEvent: Map<number, OfficialRegistrationTotals>;
  lastScrapeByEventId: Map<number, Date>;
};

type ScopedEventSummaryAggregate = {
  totalCategorias: number;
  associacoesAtletaCategoria: number;
  associacoesTecnicoClube: number;
  inscricoesTotaisOficiais: number;
  inscricoesTotaisConsolidadas: number;
  participantesUnicos: number;
  totalInscritos: number;
  totalTecnicos: number;
  groupsDefined: boolean;
  totalPartidasPublicadas: number;
  totalPartidasPrevistas: number;
  totalPartidasPrevistasFonte: "observada" | "estimada";
  totalPartidasCalculadas: number;
  totalPartidasWo: number;
  totalPartidasJogadas: number;
  totalPartidas: number;
  hasPublishedMatches: boolean;
  hasPublishedResults: boolean;
  mergedLastScrape: Date | null;
};

type ResolvedAthleteRouteContext = {
  routeAthleteId: number;
  rawAthleteId: number;
};

function toReducedName(name: string): string {
  if (isCompositePairName(name)) {
    const reducedParts = splitPairNameParts(name).map((part) => toReducedName(part)).filter(Boolean);
    if (reducedParts.length >= 2) {
      return reducedParts.join(" # ");
    }
  }

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

function resolveMedalFromPosition(
  position: number | null | undefined,
  options?: { allowDualBronze?: boolean },
): "ouro" | "prata" | "bronze" | null {
  const allowDualBronze = options?.allowDualBronze ?? true;
  if (position === 1) return "ouro";
  if (position === 2) return "prata";
  if (position === 3) return "bronze";
  if (allowDualBronze && position === 4) return "bronze";
  return null;
}

function isEfficiencyEligibleCategoryName(categoryName: string | null | undefined): boolean {
  void categoryName;
  // Regra vigente: categorias de rating (R*) tambem participam dos quadros/listas de eficiencia.
  return true;
}

function pushUniqueCategoryAthlete(
  bucket: Map<number, CategoryAthleteRef>,
  athlete: CategoryAthleteRef,
): void {
  if (!Number.isFinite(athlete.athleteId) || athlete.athleteId <= 0) {
    return;
  }
  if (bucket.has(athlete.athleteId)) {
    return;
  }
  bucket.set(athlete.athleteId, athlete);
}

function isPlaceholderClubName(clubName: string | null | undefined): boolean {
  const normalized = normalizeText(clubName ?? "");
  return !normalized || normalized === "sem clube";
}

function resolveCompositeAthleteClub(
  athleteName: string | null | undefined,
  athletePool: CategoryAthleteRef[],
): Pick<CategoryAthleteRef, "clubId" | "clubName"> | null {
  if (!isCompositePairName(athleteName)) {
    return null;
  }

  const pairMembers = splitPairNameParts(athleteName);
  if (pairMembers.length < 2) {
    return null;
  }

  const matchedClubs = new Map<string, { clubId: number | null; clubName: string }>();
  for (const member of pairMembers) {
    const match = athletePool.find(
      (candidate) =>
        !isPlaceholderClubName(candidate.clubName) &&
        !isCompositePairName(candidate.athleteName) &&
        arePairMembersEquivalent(member, candidate.athleteName),
    );
    if (!match || !match.clubName) {
      return null;
    }
    const key = normalizeText(match.clubName);
    if (!key || key === "sem clube") {
      return null;
    }
    matchedClubs.set(key, {
      clubId: match.clubId ?? null,
      clubName: match.clubName,
    });
  }

  if (matchedClubs.size !== 1) {
    return null;
  }

  return [...matchedClubs.values()][0];
}

function splitPairNameParts(name: string | null | undefined): string[] {
  return compactWhitespace(name)
    .split(/\s+#\s+|#|\s+-\s+/g)
    .map((part: string) => compactWhitespace(part))
    .filter(Boolean);
}

function isCompositePairName(name: string | null | undefined): boolean {
  const compact = compactWhitespace(name);
  return compact.includes("#") || /\s-\s/.test(compact);
}

function normalizeCompositePairName(name: string | null | undefined): string {
  const compact = compactWhitespace(name);
  const parts = splitPairNameParts(compact);
  if (parts.length < 2) {
    return compact;
  }

  const deduped = new Map<string, string>();
  for (const part of parts) {
    const normalized = normalizeAthleteName(part);
    if (!normalized || deduped.has(normalized)) {
      continue;
    }
    deduped.set(normalized, part);
  }

  if (deduped.size < 2) {
    return compact;
  }

  return [...deduped.entries()]
    .sort((left, right) => left[0].localeCompare(right[0], "pt-BR"))
    .map(([, display]) => display)
    .join(" # ");
}

function arePairMembersEquivalent(left: string, right: string): boolean {
  const normalizedLeft = normalizeAthleteName(left);
  const normalizedRight = normalizeAthleteName(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.includes(normalizedRight) ||
    normalizedRight.includes(normalizedLeft)
  );
}

function areCompetitiveEntryNamesEquivalent(left: string | null | undefined, right: string | null | undefined): boolean {
  const normalizedLeft = normalizeAthleteName(left);
  const normalizedRight = normalizeAthleteName(right);
  if (normalizedLeft && normalizedRight && normalizedLeft === normalizedRight) {
    return true;
  }

  const leftParts = splitPairNameParts(left);
  const rightParts = splitPairNameParts(right);
  if (leftParts.length >= 2 && rightParts.length >= 2 && leftParts.length === rightParts.length) {
    const remaining = [...rightParts];
    for (const leftPart of leftParts) {
      const matchIndex = remaining.findIndex((rightPart) => arePairMembersEquivalent(leftPart, rightPart));
      if (matchIndex < 0) {
        return false;
      }
      remaining.splice(matchIndex, 1);
    }
    return remaining.length === 0;
  }

  return false;
}

function buildMedalistUnitKey(input: {
  eventName?: string | null;
  categoryName: string | null | undefined;
  athleteId: number;
  athleteName: string;
}): string {
  if (
    isCompositePairName(input.athleteName) ||
    isDoublesCategoryName(input.categoryName) ||
    isDoublesEventName(input.eventName)
  ) {
    return `pair:${normalizeAthleteName(normalizeCompositePairName(input.athleteName))}`;
  }
  return `athlete:${input.athleteId}`;
}

function stableStringHash(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return Math.abs(hash >>> 0);
}

function buildCompetitiveEntryKey(categoryName: string | null | undefined, athleteName: string, athleteId?: number): string {
  if (isCompositePairName(athleteName) || isDoublesCategoryName(categoryName)) {
    return `pair:${normalizeAthleteName(normalizeCompositePairName(athleteName))}`;
  }
  return `athlete:${athleteId ?? stableStringHash(normalizeAthleteName(athleteName))}`;
}

function findEquivalentCompetitiveEntry(
  athleteName: string,
  entries: CompetitiveEntryRef[],
): CompetitiveEntryRef | null {
  for (const candidate of entries) {
    if (areCompetitiveEntryNamesEquivalent(candidate.athleteName, athleteName)) {
      return candidate;
    }
  }
  return null;
}

function buildCompetitiveEntriesForCategory(input: {
  categoryId: number;
  categoryName: string | null | undefined;
  athletePool: CategoryAthleteRef[];
  fallbackAthletePool: CategoryAthleteRef[];
  matches: CategoryAnalyticsMatch[];
}): CompetitiveEntryRef[] {
  const entries: CompetitiveEntryRef[] = [];
  const seenKeys = new Set<string>();

  const pushEntry = (entry: CompetitiveEntryRef) => {
    const key = buildCompetitiveEntryKey(input.categoryName, entry.athleteName, entry.athleteId);
    if (seenKeys.has(key)) {
      return;
    }
    seenKeys.add(key);
    entries.push(entry);
  };

  for (const athlete of input.athletePool) {
    pushEntry(athlete);
  }

  for (const match of input.matches) {
    for (const player of match.players) {
      const playerName = compactWhitespace(player?.name ?? "");
      if (!playerName) {
        continue;
      }

      const canonicalName = isCompositePairName(playerName)
        ? normalizeCompositePairName(playerName)
        : playerName;
      const existing =
        findEquivalentCompetitiveEntry(canonicalName, entries) ??
        findEquivalentCompetitiveEntry(canonicalName, input.athletePool);
      if (existing) {
        pushEntry(existing);
        continue;
      }

      const resolvedClub =
        resolveCompositeAthleteClub(canonicalName, input.athletePool) ??
        resolveCompositeAthleteClub(canonicalName, input.fallbackAthletePool);
      const syntheticId = -1 * (stableStringHash(`${input.categoryId}|${normalizeAthleteName(canonicalName)}`) + 1);
      pushEntry({
        athleteId: syntheticId,
        athleteName: canonicalName,
        clubId: resolvedClub?.clubId ?? null,
        clubName: resolvedClub?.clubName ?? null,
      });
    }
  }

  return entries;
}

function isDoublesCategoryName(categoryName: string | null | undefined): boolean {
  const normalized = normalizeText(categoryName ?? "");
  if (!normalized) {
    return false;
  }
  return /\bDUPLA(?:S)?\b/i.test(normalized);
}

function isDoublesEventName(eventName: string | null | undefined): boolean {
  const normalized = normalizeText(eventName ?? "");
  if (!normalized) {
    return false;
  }
  return /\bDUPLA(?:S)?\b/i.test(normalized);
}

function toNonNegativeInt(value: number | null | undefined): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.trunc(parsed);
}

export function computeCategoryMatchMetrics(input: {
  publishedMatchesCount: number | null | undefined;
  calculatedMatchesCount: number | null | undefined;
  walkoverMatchesCount: number | null | undefined;
}): {
  publishedMatchesCount: number;
  calculatedMatchesCount: number;
  walkoverMatchesCount: number;
  playedMatchesCount: number;
} {
  const publishedMatchesCount = toNonNegativeInt(input.publishedMatchesCount);
  const calculatedMatchesCount = Math.max(toNonNegativeInt(input.calculatedMatchesCount), publishedMatchesCount);
  // WO e contabilizado apenas sobre partidas publicadas na categoria.
  const walkoverMatchesCount = Math.min(toNonNegativeInt(input.walkoverMatchesCount), publishedMatchesCount);
  const playedMatchesCount =
    publishedMatchesCount === 0 ? 0 : Math.max(0, publishedMatchesCount - walkoverMatchesCount);

  return {
    publishedMatchesCount,
    calculatedMatchesCount,
    walkoverMatchesCount,
    playedMatchesCount,
  };
}

function countEffectiveCategoriesByEvent(input: {
  categories: Array<{ id: number; eventId: number }>;
  officialRegisteredByCategoryId: Map<number, number>;
  athleteCountByCategory: Map<number, number>;
  publishedByCategoryId: Map<number, number>;
}): Map<number, number> {
  const countByEvent = new Map<number, number>();

  for (const category of input.categories) {
    const officialRegisteredCount = input.officialRegisteredByCategoryId.get(category.id);
    const athleteCount = input.athleteCountByCategory.get(category.id) ?? 0;
    const publishedMatchesCount = input.publishedByCategoryId.get(category.id) ?? 0;

    const isCompetitiveCategory =
      (typeof officialRegisteredCount === "number" && officialRegisteredCount > 0) ||
      athleteCount > 1 ||
      publishedMatchesCount > 0;

    if (!isCompetitiveCategory) {
      continue;
    }

    countByEvent.set(category.eventId, (countByEvent.get(category.eventId) ?? 0) + 1);
  }

  return countByEvent;
}

function escapeHtml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

function countWalkoverMatches(matches: CategoryAnalyticsMatch[]): number {
  let total = 0;
  for (const match of matches) {
    const detection = detectWalkover({
      sets: match.sets,
      p1Sets: match.setsResult?.p1Sets ?? null,
      p2Sets: match.setsResult?.p2Sets ?? null,
      scoreRaw: match.scoreRaw ?? null,
    });
    if (!detection.isWalkover) {
      continue;
    }
    total += detection.isDoubleWalkover ? 2 : 1;
  }
  return total;
}

function isWalkoverByStoredScore(input: {
  sets: Array<{ p1: number; p2: number }>;
  setsResult: { p1Sets: number; p2Sets: number } | null;
  scoreRaw?: string | null;
}): boolean {
  return detectWalkover({
    sets: input.sets,
    p1Sets: input.setsResult?.p1Sets ?? null,
    p2Sets: input.setsResult?.p2Sets ?? null,
    scoreRaw: input.scoreRaw ?? null,
  }).isWalkover;
}

function parsePositiveInteger(value: string | number | undefined): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return null;
  }
  return Math.floor(parsed);
}

function resolvePaginationWindow(pageRaw?: string, pageSizeRaw?: string): PaginationWindow {
  const page = parsePositiveInteger(pageRaw) ?? 1;
  const defaultPageSize = Math.max(1, DEFAULT_USER_LIST_PAGE_SIZE);
  const configuredMaxPageSize = Math.max(defaultPageSize, MAX_USER_LIST_PAGE_SIZE);
  const pageSize = Math.min(parsePositiveInteger(pageSizeRaw) ?? defaultPageSize, configuredMaxPageSize);

  return {
    skip: (page - 1) * pageSize,
    take: pageSize,
  };
}

@Injectable()
export class UserService {
  private readonly prisma: PrismaReadService;
  private readonly prismaWrite: PrismaService;
  private globalEfficiencyCache = new Map<
    string,
    {
      cacheVersion: number;
      expiresAt: number;
      data: {
        weights: { pesoOuro: number; pesoPrata: number; pesoBronze: number };
        ranking: ClubEfficiencyRow[];
        availableYears?: number[];
      };
    }
  >();
  private readonly clubEfficiencyCache = new Map<
    number,
    {
      cacheVersion: number;
      expiresAt: number;
      data: unknown;
    }
  >();
  private stateCircuitEligibilityCache:
    | {
        expiresAt: number;
        clubIds: Set<number>;
      }
    | null = null;
  private eventMergeCache:
    | {
        expiresAt: number;
        entries: EventMergeEntry[];
      }
    | null = null;
  private static readonly EFFICIENCY_CACHE_TTL_MS = 60_000;
  private static efficiencyCacheVersion = 0;

  static invalidateEfficiencyMemoryCaches(): void {
    UserService.efficiencyCacheVersion += 1;
  }

  constructor(
    @Inject(PrismaReadService) prisma: PrismaReadService,
    @Inject(PrismaService) prismaWrite: PrismaService,
  ) {
    this.prisma = prisma;
    this.prismaWrite = prismaWrite;
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
    const safeDescriptionHtml = escapeHtml(safeDescription).replace(/\n/g, "<br/>");
    await transporter.sendMail({
      from: smtpFrom,
      to: SUPPORT_EMAIL,
      subject: `Bug Site: ${safeTitle}`,
      text: safeDescription,
      html: `<p>${safeDescriptionHtml}</p>`,
    });
  }

  private async loadEventRegistrationMetrics(eventIds: number[]): Promise<EventRegistrationMetrics> {
    const [athleteCategoryAssociations, tecnicoClubAssociations, participants] = await Promise.all([
      this.prisma.athleteCategory.findMany({
        where: {
          registrationStatus: "INSCRITO",
          athlete: {
            eventId: { in: eventIds },
            createdFromWarning: false,
          },
          category: {
            eventId: { in: eventIds },
            cbtmCategoryId: { notIn: IGNORED_CATEGORY_IDS, not: null },
          },
        },
        select: {
          category: {
            select: {
              eventId: true,
            },
          },
        },
      }),
      this.prisma.athleteCategory.findMany({
        where: {
          registrationStatus: "INSCRITO",
          athlete: {
            eventId: { in: eventIds },
            createdFromWarning: false,
          },
          category: {
            eventId: { in: eventIds },
            cbtmCategoryId: TECHNICIAN_CATEGORY_ID,
          },
        },
        select: {
          category: {
            select: {
              eventId: true,
            },
          },
        },
      }),
      this.prisma.athleteCategory.findMany({
        where: {
          registrationStatus: { not: null },
          athlete: {
            eventId: { in: eventIds },
            createdFromWarning: false,
          },
          category: {
            eventId: { in: eventIds },
            cbtmCategoryId: { notIn: IGNORED_CATEGORY_IDS, not: null },
          },
        },
        select: {
          category: {
            select: {
              eventId: true,
            },
          },
          athlete: {
            select: {
              id: true,
              nameDisplay: true,
              nameNormalized: true,
            },
          },
        },
      }),
    ]);

    const athleteCategoryAssociationsByEvent = new Map<number, number>();
    for (const row of athleteCategoryAssociations) {
      athleteCategoryAssociationsByEvent.set(
        row.category.eventId,
        (athleteCategoryAssociationsByEvent.get(row.category.eventId) ?? 0) + 1,
      );
    }

    const tecnicoClubAssociationsByEvent = new Map<number, number>();
    for (const row of tecnicoClubAssociations) {
      tecnicoClubAssociationsByEvent.set(
        row.category.eventId,
        (tecnicoClubAssociationsByEvent.get(row.category.eventId) ?? 0) + 1,
      );
    }

    const participantNamesByEvent = new Map<number, Set<string>>();
    for (const row of participants) {
      if (isCompositePairName(row.athlete.nameDisplay)) {
        continue;
      }
      const normalizedName = normalizeAthleteName(row.athlete.nameNormalized);
      if (!normalizedName) {
        continue;
      }
      const current = participantNamesByEvent.get(row.category.eventId) ?? new Set<string>();
      current.add(normalizedName);
      participantNamesByEvent.set(row.category.eventId, current);
    }

    return {
      athleteCategoryAssociationsByEvent,
      tecnicoClubAssociationsByEvent,
      participantNamesByEvent,
    };
  }

  private async loadLatestOfficialCategoryAuditByEvent(
    eventIds: number[],
  ): Promise<Map<number, Map<string, OfficialCategoryAuditRow>>> {
    const runs = await this.prisma.scrapeRun.findMany({
      where: {
        eventId: { in: eventIds },
        status: { in: ["SUCCESS", "PARTIAL"] },
      },
      orderBy: [{ eventId: "asc" }, { startedAt: "desc" }, { id: "desc" }],
      select: {
        eventId: true,
        extractionStats: true,
      },
    });

    const selected = new Map<number, Map<string, OfficialCategoryAuditRow>>();
    for (const run of runs) {
      if (selected.has(run.eventId)) {
        continue;
      }
      const extractionStats = (run.extractionStats ?? {}) as {
        capture?: {
          categoriesDiscoveredAudit?: OfficialCategoryAuditRow[];
        };
      };
      const entries = Array.isArray(extractionStats.capture?.categoriesDiscoveredAudit)
        ? extractionStats.capture?.categoriesDiscoveredAudit
        : [];
      if (!entries || entries.length === 0) {
        continue;
      }

      const byCategoryId = new Map<string, OfficialCategoryAuditRow>();
      for (const entry of entries) {
        const categoryId = String(entry?.categoryId ?? "").trim();
        if (!categoryId) {
          continue;
        }
        byCategoryId.set(categoryId, {
          categoryId,
          categoryName: String(entry?.categoryName ?? "").trim(),
          valid: Boolean(entry?.valid),
          registeredCount: Number.isFinite(Number(entry?.registeredCount))
            ? Number(entry?.registeredCount)
            : null,
          preRegisteredCount: Number.isFinite(Number(entry?.preRegisteredCount))
            ? Number(entry?.preRegisteredCount)
            : null,
          totalListedCount: Number.isFinite(Number(entry?.totalListedCount))
            ? Number(entry?.totalListedCount)
            : null,
          officialMatchesCount: Number.isFinite(Number((entry as { officialMatchesCount?: unknown })?.officialMatchesCount))
            ? Number((entry as { officialMatchesCount?: unknown })?.officialMatchesCount)
            : null,
        });
      }

      if (byCategoryId.size > 0) {
        selected.set(run.eventId, byCategoryId);
      }
    }

    return selected;
  }

  private computeOfficialRegistrationTotalsByEvent(
    officialAuditByEvent: Map<number, Map<string, OfficialCategoryAuditRow>>,
    eventRulesByEventId?: Map<number, EventOfficialRules>,
  ): Map<number, OfficialRegistrationTotals> {
    const totalsByEvent = new Map<number, OfficialRegistrationTotals>();

    for (const [eventId, categoryAudit] of officialAuditByEvent.entries()) {
      let totalListed = 0;
      let totalRegistered = 0;
      let totalMatches = 0;

      for (const row of categoryAudit.values()) {
        if (!row.valid) {
          continue;
        }
        const registered = Number.isFinite(row.registeredCount as number) ? Number(row.registeredCount) : 0;
        const preRegistered = Number.isFinite(row.preRegisteredCount as number) ? Number(row.preRegisteredCount) : 0;
        const listed =
          Number.isFinite(row.totalListedCount as number) && Number(row.totalListedCount) >= 0
            ? Number(row.totalListedCount)
            : registered + preRegistered;

        const calculatedOfficialMatches = computeOfficialCategoryMatchesCount(registered, {
          categoryName: row.categoryName,
          eventStartDate: eventRulesByEventId?.get(eventId)?.startDate ?? null,
          ratingMatchFormat: eventRulesByEventId?.get(eventId)?.ratingMatchFormat ?? "RR_K1",
          competitionFormat: eventRulesByEventId?.get(eventId)?.competitionFormat ?? "AUTO",
        });

        totalListed += listed;
        totalRegistered += Math.max(0, registered);
        totalMatches += calculatedOfficialMatches;
      }

      totalsByEvent.set(eventId, {
        totalListed,
        totalRegistered,
        totalMatches,
      });
    }

    return totalsByEvent;
  }

  private async loadScopedEventSummaryMetrics(
    eventItems: ScopedEventSummaryInput[],
  ): Promise<ScopedEventSummaryMetrics> {
    const allEventIds = [...new Set(eventItems.map((item) => item.id))];
    const [
      registrationMetrics,
      groupMatchesByEvent,
      publishedResultsByEvent,
      officialAuditByEvent,
      categoriesForAudit,
      athleteRegistrationsByCategory,
    ] = await Promise.all([
      this.loadEventRegistrationMetrics(allEventIds),
      this.prisma.match.groupBy({
        by: ["eventId"],
        where: {
          eventId: { in: allEventIds },
          OR: [{ phase: "GRUPOS" }, { round: { contains: "grupo", mode: "insensitive" } }],
          category: {
            cbtmCategoryId: { notIn: IGNORED_CATEGORY_IDS, not: null },
          },
        },
        _count: { _all: true },
      }),
      this.prisma.match.groupBy({
        by: ["eventId"],
        where: {
          eventId: { in: allEventIds },
          phase: { in: ["GRUPOS", "RESULTADOS"] },
          category: {
            cbtmCategoryId: { notIn: IGNORED_CATEGORY_IDS, not: null },
          },
          OR: [{ winnerIndex: { not: null } }, { p1Sets: { not: null } }, { p2Sets: { not: null } }],
        },
        _count: { _all: true },
      }),
      this.loadLatestOfficialCategoryAuditByEvent(allEventIds),
      this.prisma.category.findMany({
        where: {
          eventId: { in: allEventIds },
          cbtmCategoryId: { notIn: IGNORED_CATEGORY_IDS, not: null },
        },
        select: {
          id: true,
          eventId: true,
          name: true,
          cbtmCategoryId: true,
        },
      }),
      this.prisma.athleteCategory.groupBy({
        by: ["categoryId"],
        where: {
          registrationStatus: "INSCRITO",
          athlete: {
            eventId: { in: allEventIds },
            createdFromWarning: false,
          },
          category: {
            eventId: { in: allEventIds },
            cbtmCategoryId: { notIn: IGNORED_CATEGORY_IDS, not: null },
          },
        },
        _count: {
          _all: true,
        },
      }),
    ]);

    const athleteCountByCategory = new Map<number, number>();
    for (const row of athleteRegistrationsByCategory) {
      athleteCountByCategory.set(row.categoryId, row._count._all);
    }

    const eventRulesByEventId = new Map<number, EventOfficialRules>(
      eventItems.map((item) => [
        item.id,
        {
          startDate: item.dataInicio ?? item.inicioRealizacao ?? null,
          ratingMatchFormat: item.ratingMatchFormat ?? "RR_K1",
          competitionFormat: item.competitionFormat ?? "AUTO",
        },
      ]),
    );
    const officialTotalsByEvent = this.computeOfficialRegistrationTotalsByEvent(
      officialAuditByEvent,
      eventRulesByEventId,
    );

    const groupsDefinedByEventMap = new Map<number, boolean>();
    for (const row of groupMatchesByEvent) {
      groupsDefinedByEventMap.set(row.eventId, row._count._all > 0);
    }

    const publishedResultsByEventMap = new Map<number, boolean>();
    for (const row of publishedResultsByEvent) {
      publishedResultsByEventMap.set(row.eventId, row._count._all > 0);
    }

    const officialRegisteredByCategoryId = new Map<number, number>();
    for (const category of categoriesForAudit) {
      const byEvent = officialAuditByEvent.get(category.eventId);
      if (!byEvent) {
        continue;
      }
      const cbtmCategoryId = String(category.cbtmCategoryId ?? "").trim();
      const byId = cbtmCategoryId ? byEvent.get(cbtmCategoryId) : undefined;
      const byName =
        byId ??
        [...byEvent.values()].find((entry) => normalizeText(entry.categoryName) === normalizeText(category.name));
      const officialRegistered = Number(byName?.registeredCount ?? NaN);
      if (Number.isFinite(officialRegistered) && officialRegistered >= 0) {
        officialRegisteredByCategoryId.set(category.id, Math.trunc(officialRegistered));
      }
    }

    const categoryIdsForAudit = categoriesForAudit.map((category) => category.id);
    const publishedMatchesByCategory = await this.prisma.match.groupBy({
      by: ["categoryId"],
      where: {
        eventId: { in: allEventIds },
        categoryId: { in: categoryIdsForAudit },
        phase: { in: ["GRUPOS", "RESULTADOS"] },
      },
      _count: { _all: true },
    });

    const publishedByCategoryId = new Map<number, number>();
    for (const row of publishedMatchesByCategory) {
      publishedByCategoryId.set(row.categoryId, row._count._all);
    }

    const effectiveCategoryCountByEvent = countEffectiveCategoriesByEvent({
      categories: categoriesForAudit,
      officialRegisteredByCategoryId,
      athleteCountByCategory,
      publishedByCategoryId,
    });

    const walkoversByCategoryId = await this.countWalkoversByCategoryIds(allEventIds, categoryIdsForAudit);
    const metricsByEventId = new Map<number, { published: number; calculated: number; wo: number; played: number }>();
    const calibratedByEventId = new Map<number, boolean>();
    for (const category of categoriesForAudit) {
      const rules = eventRulesByEventId.get(category.eventId) ?? {
        startDate: null,
        ratingMatchFormat: "RR_K1" as const,
        competitionFormat: "AUTO" as const,
      };
      const registeredBaseCount =
        officialRegisteredByCategoryId.get(category.id) ?? (athleteCountByCategory.get(category.id) ?? 0);
      const calculatedMatchesCount = computeOfficialCategoryMatchesCount(registeredBaseCount, {
        categoryName: category.name,
        eventStartDate: rules.startDate,
        ratingMatchFormat: rules.ratingMatchFormat,
        competitionFormat: rules.competitionFormat,
      });
      const publishedMatchesCount = publishedByCategoryId.get(category.id) ?? 0;
      if (publishedMatchesCount > calculatedMatchesCount) {
        calibratedByEventId.set(category.eventId, true);
      }
      const categoryMetrics = computeCategoryMatchMetrics({
        publishedMatchesCount,
        calculatedMatchesCount,
        walkoverMatchesCount: walkoversByCategoryId.get(category.id) ?? 0,
      });
      const current = metricsByEventId.get(category.eventId) ?? { published: 0, calculated: 0, wo: 0, played: 0 };
      current.published += categoryMetrics.publishedMatchesCount;
      current.calculated += categoryMetrics.calculatedMatchesCount;
      current.wo += categoryMetrics.walkoverMatchesCount;
      current.played += categoryMetrics.playedMatchesCount;
      metricsByEventId.set(category.eventId, current);
    }

    const lastScrapeByEventId = new Map<number, Date>();
    for (const item of eventItems) {
      if (item.lastScrapeAt) {
        lastScrapeByEventId.set(item.id, item.lastScrapeAt);
      }
    }

    return {
      athleteCategoryAssociationsByEvent: registrationMetrics.athleteCategoryAssociationsByEvent,
      tecnicoClubAssociationsByEvent: registrationMetrics.tecnicoClubAssociationsByEvent,
      participantNamesByEvent: registrationMetrics.participantNamesByEvent,
      groupsDefinedByEventMap,
      publishedResultsByEventMap,
      effectiveCategoryCountByEvent,
      metricsByEventId,
      calibratedByEventId,
      officialTotalsByEvent,
      lastScrapeByEventId,
    };
  }

  private aggregateScopedEventSummary(
    allEventIds: number[],
    metrics: ScopedEventSummaryMetrics,
  ): ScopedEventSummaryAggregate {
    const totalCategorias = allEventIds.reduce(
      (sum, currentEventId) => sum + (metrics.effectiveCategoryCountByEvent.get(currentEventId) ?? 0),
      0,
    );
    const associacoesAtletaCategoria = allEventIds.reduce(
      (sum, currentEventId) => sum + (metrics.athleteCategoryAssociationsByEvent.get(currentEventId) ?? 0),
      0,
    );
    const associacoesTecnicoClube = allEventIds.reduce(
      (sum, currentEventId) => sum + (metrics.tecnicoClubAssociationsByEvent.get(currentEventId) ?? 0),
      0,
    );
    const inscricoesTotaisOficiais = allEventIds.reduce(
      (sum, currentEventId) => sum + (metrics.officialTotalsByEvent.get(currentEventId)?.totalRegistered ?? 0),
      0,
    );
    const inscricoesTotaisConsolidadas =
      inscricoesTotaisOficiais > 0 ? inscricoesTotaisOficiais : associacoesAtletaCategoria;
    const participantes = new Set<string>();
    for (const currentEventId of allEventIds) {
      const names = metrics.participantNamesByEvent.get(currentEventId);
      if (!names) {
        continue;
      }
      for (const name of names) {
        participantes.add(name);
      }
    }
    const participantesUnicos = participantes.size;
    const totalInscritos = participantesUnicos;
    const totalTecnicos = associacoesTecnicoClube;
    const groupsDefined = allEventIds.some(
      (currentEventId) => metrics.groupsDefinedByEventMap.get(currentEventId) ?? false,
    );
    const totalPartidasPublicadas = allEventIds.reduce(
      (sum, currentEventId) => sum + (metrics.metricsByEventId.get(currentEventId)?.published ?? 0),
      0,
    );
    const totalPartidasPrevistas = allEventIds.reduce(
      (sum, currentEventId) => sum + (metrics.metricsByEventId.get(currentEventId)?.calculated ?? 0),
      0,
    );
    const totalPartidasPrevistasFonte: "observada" | "estimada" = allEventIds.some(
      (currentEventId) => metrics.calibratedByEventId.get(currentEventId) ?? false,
    )
      ? "observada"
      : "estimada";
    const totalPartidasCalculadas = totalPartidasPrevistas;
    const totalPartidasWo = allEventIds.reduce(
      (sum, currentEventId) => sum + (metrics.metricsByEventId.get(currentEventId)?.wo ?? 0),
      0,
    );
    const totalPartidasJogadas = allEventIds.reduce(
      (sum, currentEventId) => sum + (metrics.metricsByEventId.get(currentEventId)?.played ?? 0),
      0,
    );
    const totalPartidas = totalPartidasCalculadas;
    const hasPublishedMatches = totalPartidasPublicadas > 0;
    const hasPublishedResults = allEventIds.some(
      (currentEventId) => metrics.publishedResultsByEventMap.get(currentEventId) ?? false,
    );
    const mergedLastScrape =
      allEventIds
        .map((currentEventId) => metrics.lastScrapeByEventId.get(currentEventId) ?? null)
        .filter((item): item is Date => Boolean(item))
        .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

    return {
      totalCategorias,
      associacoesAtletaCategoria,
      associacoesTecnicoClube,
      inscricoesTotaisOficiais,
      inscricoesTotaisConsolidadas,
      participantesUnicos,
      totalInscritos,
      totalTecnicos,
      groupsDefined,
      totalPartidasPublicadas,
      totalPartidasPrevistas,
      totalPartidasPrevistasFonte,
      totalPartidasCalculadas,
      totalPartidasWo,
      totalPartidasJogadas,
      totalPartidas,
      hasPublishedMatches,
      hasPublishedResults,
      mergedLastScrape,
    };
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
          ratingMatchFormat: true,
          competitionFormat: true,
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
    const scopedEventItems = events
      .filter((item) => allScopedEventIds.includes(item.id))
      .map((item) => ({
        id: item.id,
        lastScrapeAt: item.lastScrapeAt,
        dataInicio: item.dataInicio,
        inicioRealizacao: item.inicioRealizacao,
        ratingMatchFormat: item.ratingMatchFormat,
        competitionFormat: item.competitionFormat,
      }));
    const sharedMetrics = await this.loadScopedEventSummaryMetrics(scopedEventItems);

    return displayEvents.map((event) => {
      const scope = scopeByEventId.get(event.id) ?? {
        canonicalEventId: event.id,
        allEventIds: [event.id],
        childSuffixByEventId: new Map<number, string>(),
      };
      const aggregate = this.aggregateScopedEventSummary(scope.allEventIds, sharedMetrics);

      return {
        ...event,
        lastScrapeAt: aggregate.mergedLastScrape,
        situacaoComputada: computeEventSituation({
          inicioInscricoes: event.inicioInscricoes,
          fimInscricoes: event.fimInscricoes,
          inicioRealizacao: event.inicioRealizacao,
          fimRealizacao: event.fimRealizacao,
          dataInicio: event.dataInicio,
          dataFim: event.dataFim,
          hasPublishedMatches: aggregate.hasPublishedMatches,
          hasPublishedResults: aggregate.hasPublishedResults,
        }),
        totalCategorias: aggregate.totalCategorias,
        totalInscritos: aggregate.totalInscritos,
        totalPartidasPublicadas: aggregate.totalPartidasPublicadas,
        totalPartidasPrevistas: aggregate.totalPartidasPrevistas,
        totalPartidasPrevistasFonte: aggregate.totalPartidasPrevistasFonte,
        totalPartidas: aggregate.totalPartidas,
        totalPartidasCalculadas: aggregate.totalPartidasCalculadas,
        totalPartidasWo: aggregate.totalPartidasWo,
        totalPartidasJogadas: aggregate.totalPartidasJogadas,
        totalTecnicos: aggregate.totalTecnicos,
        inscricoesTotaisOficiais: aggregate.inscricoesTotaisConsolidadas,
        associacoesAtletaCategoria: aggregate.associacoesAtletaCategoria,
        associacoesTecnicoClube: aggregate.associacoesTecnicoClube,
        participantesUnicos: aggregate.participantesUnicos,
        groupsDefined: aggregate.groupsDefined,
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

  async getEventSummary(eventId: number) {
    const scope = await this.resolveEventScope(eventId);
    const event = await this.ensureEvent(scope.canonicalEventId);
    const latestReliableRunId = await this.getLatestReliableScrapeRunIdForScope(scope.allEventIds);
    const cacheKey = this.buildReadModelKey("event-summary-v14", scope.canonicalEventId);
    return this.resolveEventReadModelCache({
      event,
      cacheKey,
      kind: "event-summary",
      eventId: scope.canonicalEventId,
      scopeEventIds: scope.allEventIds,
      latestReliableRunId,
      buildingPayload: {
        id: event.id,
        cbtmEventId: event.cbtmEventId,
        nome: event.nome,
        nivel: event.nivel,
        inicioInscricoes: event.inicioInscricoes,
        fimInscricoes: event.fimInscricoes,
        inicioRealizacao: event.inicioRealizacao,
        fimRealizacao: event.fimRealizacao,
        dataInicio: event.dataInicio,
        dataFim: event.dataFim,
        concluido: event.concluido,
        lastScrapeAt: event.lastScrapeAt ?? null,
        publishedAt: null,
        situacaoComputada: computeEventSituation({ ...event, hasPublishedMatches: false, hasPublishedResults: false }),
        totalCategorias: 0,
        totalInscritos: 0,
        totalPartidasPublicadas: 0,
        totalPartidasPrevistas: 0,
        totalPartidasPrevistasFonte: "estimada",
        totalPartidas: 0,
        totalPartidasCalculadas: 0,
        totalPartidasWo: 0,
        totalPartidasJogadas: 0,
        totalTecnicos: 0,
        inscricoesTotaisOficiais: 0,
        associacoesAtletaCategoria: 0,
        associacoesTecnicoClube: 0,
        participantesUnicos: 0,
        groupsDefined: false,
        userStatus: resolveUserEventStatus({
          concluido: event.concluido,
          eventSituation: computeEventSituation({ ...event, hasPublishedMatches: false, hasPublishedResults: false }),
        }),
        groupSimulationEligible: false,
        _meta: { building: true },
      } as Record<string, unknown>,
      compute: async () => {
        const allEventIds = scope.allEventIds;
        const scopedLastScrape = await this.prisma.event.findMany({
          where: { id: { in: allEventIds } },
          select: {
            id: true,
            lastScrapeAt: true,
            dataInicio: true,
            inicioRealizacao: true,
            ratingMatchFormat: true,
            competitionFormat: true,
          },
        });
        const sharedMetrics = await this.loadScopedEventSummaryMetrics(scopedLastScrape);
        const aggregate = this.aggregateScopedEventSummary(allEventIds, sharedMetrics);

        const situacaoComputada = computeEventSituation({
          ...event,
          hasPublishedMatches: aggregate.hasPublishedMatches,
          hasPublishedResults: aggregate.hasPublishedResults,
        });

        return {
          id: event.id,
          cbtmEventId: event.cbtmEventId,
          nome: event.nome,
          nivel: event.nivel,
          inicioInscricoes: event.inicioInscricoes,
          fimInscricoes: event.fimInscricoes,
          inicioRealizacao: event.inicioRealizacao,
          fimRealizacao: event.fimRealizacao,
          dataInicio: event.dataInicio,
          dataFim: event.dataFim,
          concluido: event.concluido,
          lastScrapeAt: aggregate.mergedLastScrape,
          publishedAt: null,
          situacaoComputada,
          totalCategorias: aggregate.totalCategorias,
          totalInscritos: aggregate.totalInscritos,
          totalPartidasPublicadas: aggregate.totalPartidasPublicadas,
          totalPartidasPrevistas: aggregate.totalPartidasPrevistas,
          totalPartidasPrevistasFonte: aggregate.totalPartidasPrevistasFonte,
          totalPartidas: aggregate.totalPartidas,
          totalPartidasCalculadas: aggregate.totalPartidasCalculadas,
          totalPartidasWo: aggregate.totalPartidasWo,
          totalPartidasJogadas: aggregate.totalPartidasJogadas,
          totalTecnicos: aggregate.totalTecnicos,
          inscricoesTotaisOficiais: aggregate.inscricoesTotaisConsolidadas,
          associacoesAtletaCategoria: aggregate.associacoesAtletaCategoria,
          associacoesTecnicoClube: aggregate.associacoesTecnicoClube,
          participantesUnicos: aggregate.participantesUnicos,
          groupsDefined: aggregate.groupsDefined,
          userStatus: resolveUserEventStatus({
            concluido: event.concluido,
            eventSituation: situacaoComputada,
          }),
          groupSimulationEligible: canUseGroupSimulation({
            concluido: event.concluido,
            groupsDefined: aggregate.groupsDefined,
            eventSituation: situacaoComputada,
          }),
        };
      },
    });
  }

  async listAthletes(eventId: number, search: string, pageRaw?: string, pageSizeRaw?: string) {
    const scope = await this.resolveEventScope(eventId);
    if (!this.hasReadModelCacheSupport()) {
      return this.listAthletesLegacy(scope, search, pageRaw, pageSizeRaw);
    }
    const event = await this.ensureEvent(scope.canonicalEventId);
    const pagination = resolvePaginationWindow(pageRaw, pageSizeRaw);
    const latestReliableRunId = await this.getLatestReliableScrapeRunIdForScope(scope.allEventIds);
    const snapshot = await this.resolveEventReadModelCache<EventAthletesSnapshot>({
      event,
      cacheKey: this.buildReadModelKey("event-athletes-v1", scope.canonicalEventId),
      kind: "event-athletes",
      eventId: scope.canonicalEventId,
      scopeEventIds: scope.allEventIds,
      latestReliableRunId,
      buildingPayload: { eventId: scope.canonicalEventId, items: [], _meta: { building: true } },
      compute: () => this.buildEventAthletesSnapshot(scope),
    });
    return this.selectAthletesFromSnapshot(snapshot, search, pagination);
  }

  private async buildEventAthletesSnapshot(scope: EventScope): Promise<EventAthletesSnapshot> {
    const eligibleClubIds = await this.getStateCircuitEligibleClubIds();
    if (eligibleClubIds.size === 0) {
      return { eventId: scope.canonicalEventId, items: [] };
    }

    const athletes = await this.prisma.athlete.findMany({
      where: {
        eventId: { in: scope.allEventIds },
        createdFromWarning: false,
        clubId: { in: [...eligibleClubIds] },
        categories: {
          some: {
            registrationStatus: "INSCRITO",
          },
        },
      },
      select: {
        id: true,
        eventId: true,
        nameDisplay: true,
        nameNormalized: true,
        stateCode: true,
        region: true,
        club: {
          select: {
            id: true,
            name: true,
            normalizedName: true,
          },
        },
      },
      orderBy: [{ nameDisplay: "asc" }],
    });

    const routeIdByAthleteId = await this.ensureStableAthleteRouteIds(
      athletes.map((athlete) => ({
        eventId: athlete.eventId,
        athleteId: athlete.id,
        athleteName: athlete.nameDisplay,
        athleteNameNormalized: athlete.nameNormalized,
        clubNormalizedName: athlete.club?.normalizedName ?? null,
      })),
    );

    return {
      eventId: scope.canonicalEventId,
      items: athletes.map((athlete) => ({
        id: routeIdByAthleteId.get(athlete.id) ?? athlete.id,
        rawAthleteId: athlete.id,
        eventId: athlete.eventId,
        nameDisplay: athlete.nameDisplay,
        nameNormalized: athlete.nameNormalized,
        stateCode: athlete.stateCode,
        region: athlete.region,
        club: athlete.club
          ? {
              id: athlete.club.id,
              name: athlete.club.name,
              normalizedName: athlete.club.normalizedName,
            }
          : null,
      })),
    };
  }

  private hasReadModelCacheSupport(): boolean {
    return Boolean(this.getReadModelCacheReader() || this.getReadModelCacheWriter());
  }

  private async listAthletesLegacy(scope: EventScope, search: string, pageRaw?: string, pageSizeRaw?: string) {
    await this.ensureEvent(scope.canonicalEventId);
    const pagination = resolvePaginationWindow(pageRaw, pageSizeRaw);
    const normalizedSearch = normalizeAthleteName(search);
    const eligibleClubIds = await this.getStateCircuitEligibleClubIds();
    if (eligibleClubIds.size === 0) {
      return [];
    }

    const athletes = await this.prisma.athlete.findMany({
      where: {
        eventId: { in: scope.allEventIds },
        createdFromWarning: false,
        clubId: { in: [...eligibleClubIds] },
        categories: {
          some: {
            registrationStatus: "INSCRITO",
          },
        },
        AND: [
          {
            nameNormalized: {
              contains: normalizedSearch || undefined,
              mode: "insensitive",
            },
          },
        ],
      },
      select: {
        id: true,
        eventId: true,
        nameDisplay: true,
        nameNormalized: true,
        stateCode: true,
        region: true,
        club: {
          select: {
            id: true,
            name: true,
            normalizedName: true,
          },
        },
      },
      orderBy: [{ nameDisplay: "asc" }],
      skip: pagination.skip,
      take: pagination.take,
    });

    const routeIdByAthleteId = await this.ensureStableAthleteRouteIds(
      athletes.map((athlete) => ({
        eventId: athlete.eventId,
        athleteId: athlete.id,
        athleteName: athlete.nameDisplay,
        athleteNameNormalized: athlete.nameNormalized,
        clubNormalizedName: athlete.club?.normalizedName ?? null,
      })),
    );

    return athletes.map((athlete) => ({
      id: routeIdByAthleteId.get(athlete.id) ?? athlete.id,
      rawAthleteId: athlete.id,
      nameDisplay: athlete.nameDisplay,
      stateCode: athlete.stateCode,
      region: athlete.region,
      club: athlete.club
        ? {
            id: athlete.club.id,
            name: athlete.club.name,
          }
        : null,
    }));
  }

  async listClubs(
    eventId: number,
    search: string,
    categoryId: number | null,
    pageRaw?: string,
    pageSizeRaw?: string,
  ) {
    const scope = await this.resolveEventScope(eventId);
    if (!this.hasReadModelCacheSupport()) {
      return this.listClubsLegacy(scope, search, categoryId, pageRaw, pageSizeRaw);
    }
    const event = await this.ensureEvent(scope.canonicalEventId);
    const pagination = resolvePaginationWindow(pageRaw, pageSizeRaw);
    const latestReliableRunId = await this.getLatestReliableScrapeRunIdForScope(scope.allEventIds);
    const snapshot = await this.resolveEventReadModelCache<EventClubsSnapshot>({
      event,
      cacheKey: this.buildReadModelKey("event-clubs-v1", scope.canonicalEventId),
      kind: "event-clubs",
      eventId: scope.canonicalEventId,
      scopeEventIds: scope.allEventIds,
      latestReliableRunId,
      buildingPayload: { eventId: scope.canonicalEventId, clubs: [], _meta: { building: true } },
      compute: () => this.buildEventClubsSnapshot(scope),
    });
    return this.selectClubsFromSnapshot(snapshot, search, categoryId, pagination, true);
  }

  private async buildEventClubsSnapshot(scope: EventScope): Promise<EventClubsSnapshot> {
    const eligibleClubIds = await this.getStateCircuitEligibleClubIds();
    if (eligibleClubIds.size === 0) {
      return { eventId: scope.canonicalEventId, clubs: [] };
    }

    const athletes = await this.prisma.athlete.findMany({
      where: {
        eventId: { in: scope.allEventIds },
        createdFromWarning: false,
        clubId: { in: [...eligibleClubIds] },
        categories: {
          some: {
            registrationStatus: "INSCRITO",
          },
        },
      },
      select: {
        id: true,
        eventId: true,
        nameDisplay: true,
        nameNormalized: true,
        stateCode: true,
        region: true,
        club: {
          select: {
            id: true,
            name: true,
            normalizedName: true,
          },
        },
        categories: {
          where: { registrationStatus: "INSCRITO" },
          select: {
            categoryId: true,
            category: {
              select: {
                id: true,
                eventId: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: [{ eventId: "asc" }, { nameDisplay: "asc" }],
    });

    const routeIdByAthleteId = await this.ensureStableAthleteRouteIds(
      athletes.map((athlete) => ({
        eventId: athlete.eventId,
        athleteId: athlete.id,
        athleteName: athlete.nameDisplay,
        athleteNameNormalized: athlete.nameNormalized,
        clubNormalizedName: athlete.club?.normalizedName ?? null,
      })),
    );

    const clubsById = new Map<number, EventClubSnapshotItem>();
    for (const athlete of athletes) {
      if (!athlete.club) {
        continue;
      }
      const club =
        clubsById.get(athlete.club.id) ??
        {
          id: athlete.club.id,
          name: athlete.club.name,
          normalizedName: athlete.club.normalizedName,
          athletes: [],
        };
      club.athletes.push({
        id: routeIdByAthleteId.get(athlete.id) ?? athlete.id,
        rawAthleteId: athlete.id,
        eventId: athlete.eventId,
        nameDisplay: athlete.nameDisplay,
        nameNormalized: athlete.nameNormalized,
        stateCode: athlete.stateCode,
        region: athlete.region,
        club: {
          id: athlete.club.id,
          name: athlete.club.name,
          normalizedName: athlete.club.normalizedName,
        },
        categoryIds: athlete.categories.map((item) => item.categoryId),
        categoryNames: Array.from(
          new Set(
            athlete.categories
              .map((item) => item.category)
              .filter((category): category is { id: number; eventId: number; name: string } => Boolean(category))
              .map((category) =>
                category.eventId === scope.canonicalEventId
                  ? category.name
                  : `${category.name}${scope.childSuffixByEventId.get(category.eventId) ?? " -X"}`,
              ),
          ),
        ).sort((left, right) => left.localeCompare(right, "pt-BR", { sensitivity: "base" })),
      });
      clubsById.set(club.id, club);
    }

    return {
      eventId: scope.canonicalEventId,
      clubs: [...clubsById.values()].sort((left, right) =>
        left.name.localeCompare(right.name, "pt-BR", { sensitivity: "base" }),
      ),
    };
  }

  private async listClubsLegacy(
    scope: EventScope,
    search: string,
    categoryId: number | null,
    pageRaw?: string,
    pageSizeRaw?: string,
  ) {
    await this.ensureEvent(scope.canonicalEventId);
    const pagination = resolvePaginationWindow(pageRaw, pageSizeRaw);
    const normalizedSearch = normalizeAthleteName(search);
    const eligibleClubIds = await this.getStateCircuitEligibleClubIds();
    if (eligibleClubIds.size === 0) {
      return [];
    }
    if (categoryId) {
      await this.ensureCategoryOfEvent(scope.allEventIds, categoryId);
    }

    const clubs = await this.prisma.club.findMany({
      where: {
        id: { in: [...eligibleClubIds] },
        normalizedName: {
          contains: normalizedSearch || undefined,
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
                    registrationStatus: "INSCRITO",
                  },
                }
              : {
                  some: {
                    registrationStatus: "INSCRITO",
                  },
                },
          },
        },
      },
      select: {
        id: true,
        name: true,
      },
      orderBy: [{ name: "asc" }],
      skip: pagination.skip,
      take: pagination.take,
    });

    if (clubs.length === 0) {
      return [];
    }

    const clubIds = clubs.map((club) => club.id);
    const athletesByClub = await this.prisma.athlete.findMany({
      where: {
        eventId: { in: scope.allEventIds },
        createdFromWarning: false,
        clubId: { in: clubIds },
        categories: categoryId
          ? {
              some: {
                categoryId,
                registrationStatus: "INSCRITO",
              },
            }
          : {
              some: {
                registrationStatus: "INSCRITO",
              },
            },
      },
      select: {
        clubId: true,
        nameNormalized: true,
      },
      distinct: ["clubId", "nameNormalized"],
    });

    const athleteCountByClub = new Map<number, number>();
    for (const row of athletesByClub) {
      athleteCountByClub.set(row.clubId, (athleteCountByClub.get(row.clubId) ?? 0) + 1);
    }

    return clubs.map((club) => ({
      ...club,
      athleteCount: athleteCountByClub.get(club.id) ?? 0,
    }));
  }

  async listCategories(eventId: number) {
    const scope = await this.resolveEventScope(eventId);
    const event = await this.ensureEvent(scope.canonicalEventId);
    const latestReliableRunId = await this.getLatestReliableScrapeRunIdForScope(scope.allEventIds);
    const snapshot = await this.resolveEventReadModelCache<EventCategoriesSnapshot>({
      event,
      cacheKey: this.buildReadModelKey("event-categories-v1", scope.canonicalEventId),
      kind: "event-categories",
      eventId: scope.canonicalEventId,
      scopeEventIds: scope.allEventIds,
      latestReliableRunId,
      buildingPayload: { eventId: scope.canonicalEventId, items: [], _meta: { building: true } },
      compute: () => this.buildEventCategoriesSnapshot(scope),
    });
    return snapshot.items;
  }

  private async buildEventCategoriesSnapshot(scope: EventScope): Promise<EventCategoriesSnapshot> {
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

    return {
      eventId: scope.canonicalEventId,
      items: categories.map((category) => ({
        ...category,
        name:
          category.eventId === scope.canonicalEventId
            ? category.name
            : `${category.name}${scope.childSuffixByEventId.get(category.eventId) ?? " -X"}`,
      })),
    };
  }

  async listEventEfficiency(eventId: number) {
    const scope = await this.resolveEventScope(eventId);
    const event = await this.ensureEvent(scope.canonicalEventId);
    const latestReliableRunId = await this.getLatestReliableScrapeRunIdForScope(scope.allEventIds);
    const cacheKey = this.buildReadModelKey("event-efficiency-v4", scope.canonicalEventId);
    return this.resolveEventReadModelCache({
      event,
      cacheKey,
      kind: "event-efficiency",
      eventId: scope.canonicalEventId,
      scopeEventIds: scope.allEventIds,
      latestReliableRunId,
      compute: async () => {
        const response = await this.computeEfficiencyRanking({ eventIds: scope.allEventIds });
        const eventWeight = this.resolveEfficiencyEventWeight(event.nivel ?? null, event.nome ?? null);
        return {
          eventId: scope.canonicalEventId,
          eventWeight,
          ...response,
        };
      },
    });
  }

  async listEventCategoryMedalists(eventId: number): Promise<{
    eventId: number;
    categories: EventCategoryMedalistRow[];
    _meta?: Record<string, unknown>;
  }> {
    const scope = await this.resolveEventScope(eventId);
    const event = await this.ensureEvent(scope.canonicalEventId);
    const latestReliableRunId = await this.getLatestReliableScrapeRunIdForScope(scope.allEventIds);
    const cacheKey = this.buildReadModelKey("event-medalists-v4", scope.canonicalEventId);
    return this.resolveEventReadModelCache({
      event,
      cacheKey,
      kind: "event-medalists",
      eventId: scope.canonicalEventId,
      scopeEventIds: scope.allEventIds,
      latestReliableRunId,
      compute: async () => {
        const categories = await this.prisma.category.findMany({
          where: {
            eventId: { in: scope.allEventIds },
            cbtmCategoryId: { notIn: IGNORED_CATEGORY_IDS, not: null },
          },
          orderBy: [{ name: "asc" }],
          select: {
            id: true,
            eventId: true,
            name: true,
            cbtmCategoryId: true,
          },
        });
        const categoriesForMedalistList = categories;
        if (categoriesForMedalistList.length === 0) {
          return {
            eventId: scope.canonicalEventId,
            categories: [],
          };
        }

        const categoryIds = categoriesForMedalistList.map((category) => category.id);
        const [athleteCategories, fullCategoryMatchesRaw, officialAuditByEvent, scopedEvents] = await Promise.all([
      this.prisma.athleteCategory.findMany({
        where: {
          categoryId: { in: categoryIds },
          registrationStatus: "INSCRITO",
          athlete: {
            eventId: { in: scope.allEventIds },
            createdFromWarning: false,
          },
        },
        select: {
          categoryId: true,
          athlete: {
            select: {
              id: true,
              nameDisplay: true,
              club: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.match.findMany({
        where: {
          categoryId: { in: categoryIds },
          eventId: { in: scope.allEventIds },
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
      this.loadLatestOfficialCategoryAuditByEvent(scope.allEventIds),
      this.prisma.event.findMany({
        where: {
          id: { in: scope.allEventIds },
        },
        select: {
          id: true,
          dataInicio: true,
          inicioRealizacao: true,
          ratingMatchFormat: true,
          competitionFormat: true,
        },
      }),
    ]);
        const eventRulesByEventId = new Map<number, EventOfficialRules>(
      scopedEvents.map((item) => [
        item.id,
        {
          startDate: item.dataInicio ?? item.inicioRealizacao ?? null,
          ratingMatchFormat: item.ratingMatchFormat ?? "RR_K1",
          competitionFormat: item.competitionFormat ?? "AUTO",
        },
      ]),
    );

        const officialAuditByCategoryId = new Map<string, OfficialCategoryAuditRow>();
        const officialAuditByCategoryName = new Map<string, OfficialCategoryAuditRow>();
        for (const category of categoriesForMedalistList) {
      const byEvent = officialAuditByEvent.get(category.eventId);
      if (!byEvent) {
        continue;
      }
      const cbtmCategoryId = String(category.cbtmCategoryId ?? "").trim();
      if (cbtmCategoryId) {
        const found = byEvent.get(cbtmCategoryId);
        if (found) {
          officialAuditByCategoryId.set(String(category.id), found);
          continue;
        }
      }
      const normalizedCategoryName = normalizeText(category.name);
      if (normalizedCategoryName) {
        for (const entry of byEvent.values()) {
          if (normalizeText(entry.categoryName) === normalizedCategoryName) {
            officialAuditByCategoryName.set(String(category.id), entry);
            break;
          }
        }
      }
        }

        const athletesByCategory = new Map<number, Map<number, CategoryAthleteRef>>();
        const scopedAthletesPool = new Map<number, CategoryAthleteRef>();
        for (const row of athleteCategories) {
      const bucket = athletesByCategory.get(row.categoryId) ?? new Map<number, CategoryAthleteRef>();
      const athleteRef = {
        athleteId: row.athlete.id,
        athleteName: row.athlete.nameDisplay,
        clubId: row.athlete.club?.id ?? null,
        clubName: row.athlete.club?.name ?? null,
      };
      pushUniqueCategoryAthlete(bucket, athleteRef);
      pushUniqueCategoryAthlete(scopedAthletesPool, athleteRef);
      athletesByCategory.set(row.categoryId, bucket);
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

      const athletesBucket = athletesByCategory.get(match.categoryId) ?? new Map<number, CategoryAthleteRef>();
      for (const participant of match.participants) {
        const athleteRef = {
          athleteId: participant.athlete.id,
          athleteName: participant.athlete.nameDisplay,
          clubId: participant.athlete.club?.id ?? null,
          clubName: participant.athlete.club?.name ?? null,
        };
        pushUniqueCategoryAthlete(athletesBucket, athleteRef);
        if (!isPlaceholderClubName(athleteRef.clubName)) {
          pushUniqueCategoryAthlete(scopedAthletesPool, athleteRef);
        }
      }
      athletesByCategory.set(match.categoryId, athletesBucket);
        }

        const medalOrder: Record<"ouro" | "prata" | "bronze", number> = {
      ouro: 0,
      prata: 1,
      bronze: 2,
        };

        const categoriesWithMedalists: EventCategoryMedalistRow[] = categoriesForMedalistList.map((category) => {
      const categoryName =
        category.eventId === scope.canonicalEventId
          ? category.name
          : `${category.name}${scope.childSuffixByEventId.get(category.eventId) ?? " -X"}`;
      const athletes = [...(athletesByCategory.get(category.id)?.values() ?? [])];
      const fallbackAthletePool = [...scopedAthletesPool.values()];
      const fullCategoryMatches = fullCategoryMatchesMap.get(category.id) ?? [];
      const competitiveEntries = buildCompetitiveEntriesForCategory({
        categoryId: category.id,
        categoryName,
        athletePool: athletes,
        fallbackAthletePool,
        matches: fullCategoryMatches,
      });
      const medalExpectation = inferCategoryMedalExpectation(fullCategoryMatches);
      const allowDualBronze = (medalExpectation?.expectedMedalists ?? 0) >= 4;
      const walkoverMatchesCount = countWalkoverMatches(fullCategoryMatches);
      const woDisqualifiedAthleteIds = collectWalkoverLoserAthleteIds(fullCategoryMatches);
      const positionByAthleteId = this.computeCategoryPositionByAthleteId(
        fullCategoryMatches,
        competitiveEntries.map((athlete) => ({
          athleteId: athlete.athleteId,
          athleteName: athlete.athleteName,
        })),
      );

      const medalistsRaw: EventCategoryMedalist[] = competitiveEntries
        .flatMap((athlete) => {
          if (woDisqualifiedAthleteIds.has(athlete.athleteId)) {
            return [];
          }
          const position = positionByAthleteId.get(athlete.athleteId) ?? null;
          const medalha = resolveMedalFromPosition(position, { allowDualBronze });
          if (!medalha || position === null) {
            return [];
          }
          const resolvedClub =
            isPlaceholderClubName(athlete.clubName)
              ? resolveCompositeAthleteClub(athlete.athleteName, competitiveEntries) ??
                resolveCompositeAthleteClub(athlete.athleteName, fallbackAthletePool)
              : null;
          return [{
            athleteId: athlete.athleteId,
            athleteName: athlete.athleteName,
            clubName: resolvedClub?.clubName ?? athlete.clubName,
            position,
            medalha,
            unitKey: buildMedalistUnitKey({
              categoryName,
              athleteId: athlete.athleteId,
              athleteName: athlete.athleteName,
            }),
          }];
        })
        .sort((left, right) => {
          const medalDiff = medalOrder[left.medalha] - medalOrder[right.medalha];
          if (medalDiff !== 0) {
            return medalDiff;
          }
          if (left.position !== right.position) {
            return left.position - right.position;
          }
          return left.athleteName.localeCompare(right.athleteName, "pt-BR", { sensitivity: "base" });
        });
      const medalists = normalizeCategoryMedalists(medalistsRaw);
      const officialAudit =
        officialAuditByCategoryId.get(String(category.id)) ??
        officialAuditByCategoryName.get(String(category.id)) ??
        null;
      const officialRegisteredCount = officialAudit?.registeredCount ?? null;
      const officialPreRegisteredCount = officialAudit?.preRegisteredCount ?? null;
      const officialTotalListedCount = officialAudit?.totalListedCount ?? null;
      const officialMatchesCount =
        typeof officialRegisteredCount === "number" && officialRegisteredCount >= 0
          ? computeOfficialCategoryMatchesCount(officialRegisteredCount, {
              categoryName: category.name,
              eventStartDate: eventRulesByEventId.get(category.eventId)?.startDate ?? null,
              ratingMatchFormat: eventRulesByEventId.get(category.eventId)?.ratingMatchFormat ?? "RR_K1",
              competitionFormat: eventRulesByEventId.get(category.eventId)?.competitionFormat ?? "AUTO",
            })
          : null;
      const registeredBaseCount =
        typeof officialRegisteredCount === "number" && officialRegisteredCount >= 0
          ? officialRegisteredCount
          : competitiveEntries.length;
      const fallbackCalculatedMatchesCount = computeOfficialCategoryMatchesCount(registeredBaseCount, {
        categoryName: category.name,
        eventStartDate: eventRulesByEventId.get(category.eventId)?.startDate ?? null,
        ratingMatchFormat: eventRulesByEventId.get(category.eventId)?.ratingMatchFormat ?? "RR_K1",
        competitionFormat: eventRulesByEventId.get(category.eventId)?.competitionFormat ?? "AUTO",
      });
      const calculatedMatchesCount =
        typeof officialMatchesCount === "number" && officialMatchesCount >= 0
          ? officialMatchesCount
          : fallbackCalculatedMatchesCount;
      const categoryMetrics = computeCategoryMatchMetrics({
        publishedMatchesCount: fullCategoryMatches.length,
        calculatedMatchesCount,
        walkoverMatchesCount,
      });
      const expectedMedalists =
        fullCategoryMatches.length === 0
          ? 0
          : medalExpectation?.expectedMedalists ??
            (registeredBaseCount <= 3 ? registeredBaseCount : 4);
      const athleteCount =
        typeof officialRegisteredCount === "number" && officialRegisteredCount >= 0
          ? officialRegisteredCount
          : competitiveEntries.length;
      const diagnostics = buildEventCategoryMedalistDiagnostics({
        athleteCount,
        publishedMatchesCount: fullCategoryMatches.length,
        medalistsCount: medalists.length,
        expectedMedalists,
      });

      return {
        categoryId: category.id,
        categoryName,
        athleteCount,
        officialRegisteredCount,
        officialPreRegisteredCount,
        officialTotalListedCount,
        expectedMedalists,
        publishedMatchesCount: categoryMetrics.publishedMatchesCount,
        calculatedMatchesCount: categoryMetrics.calculatedMatchesCount,
        walkoverMatchesCount: categoryMetrics.walkoverMatchesCount,
        playedMatchesCount: categoryMetrics.playedMatchesCount,
        medalists,
        diagnostics,
      };
        });

        return {
          eventId: scope.canonicalEventId,
          categories: categoriesWithMedalists.filter(
            (category) =>
              category.medalists.length > 0 ||
              category.publishedMatchesCount > 0 ||
              (category.expectedMedalists ?? 0) > 0,
          ),
        };
      },
    });
  }

  async listEventSchedule(eventId: number): Promise<{
    eventId: number;
    categories: Array<{
      categoryId: number;
      categoryName: string;
      matches: Array<{
        id: number;
        matchKey: string;
        round: string | null;
        tableNumber: string | null;
        matchDatetime: string | null;
        scoreRaw: string | null;
        playerA: { id: number | null; name: string; clubName: string | null } | null;
        playerB: { id: number | null; name: string; clubName: string | null } | null;
      }>;
    }>;
  }> {
    const scope = await this.resolveEventScope(eventId);
    const event = await this.ensureEvent(scope.canonicalEventId);
    const latestReliableRunId = await this.getLatestReliableScrapeRunIdForScope(scope.allEventIds);
    return this.resolveEventReadModelCache<EventScheduleSnapshot>({
      event,
      cacheKey: this.buildReadModelKey("event-schedule-v1", scope.canonicalEventId),
      kind: "event-schedule",
      eventId: scope.canonicalEventId,
      scopeEventIds: scope.allEventIds,
      latestReliableRunId,
      buildingPayload: { eventId: scope.canonicalEventId, categories: [], _meta: { building: true } },
      compute: () => this.buildEventScheduleSnapshot(scope),
    });
  }

  private async buildEventScheduleSnapshot(scope: EventScope): Promise<EventScheduleSnapshot> {
    const matches = await this.prisma.match.findMany({
      where: {
        eventId: { in: scope.allEventIds },
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
    });

    const orderedMatches = matches
      .filter((match) => !match.category.cbtmCategoryId || !IGNORED_CATEGORY_IDS.includes(match.category.cbtmCategoryId))
      .sort((left, right) => {
        const leftTime = left.matchDatetime?.getTime() ?? Number.POSITIVE_INFINITY;
        const rightTime = right.matchDatetime?.getTime() ?? Number.POSITIVE_INFINITY;
        if (leftTime !== rightTime) {
          return leftTime - rightTime;
        }
        const roundCompare = (left.round ?? "").localeCompare(right.round ?? "", "pt-BR", { sensitivity: "base" });
        if (roundCompare !== 0) {
          return roundCompare;
        }
        const tableCompare = (left.tableNumber ?? "").localeCompare(right.tableNumber ?? "", "pt-BR", {
          numeric: true,
          sensitivity: "base",
        });
        if (tableCompare !== 0) {
          return tableCompare;
        }
        return left.id - right.id;
      });

    const categories = new Map<
      number,
      {
        categoryId: number;
        categoryName: string;
        firstMatchTimestamp: number;
        matches: Array<{
          id: number;
          matchKey: string;
          round: string | null;
          tableNumber: string | null;
          matchDatetime: string | null;
          scoreRaw: string | null;
          playerA: { id: number | null; name: string; clubName: string | null } | null;
          playerB: { id: number | null; name: string; clubName: string | null } | null;
        }>;
      }
    >();

    const toSchedulePlayer = (player: AthleteSummaryPlayer | null) =>
      player
        ? {
            id: player.id,
            name: player.name,
            clubName: player.club?.name ?? null,
          }
        : null;

    for (const match of orderedMatches) {
      const categoryName =
        match.category.eventId === scope.canonicalEventId
          ? match.category.name
          : `${match.category.name}${scope.childSuffixByEventId.get(match.category.eventId) ?? " -X"}`;
      const bucket =
        categories.get(match.category.id) ??
        {
          categoryId: match.category.id,
          categoryName,
          firstMatchTimestamp: match.matchDatetime?.getTime() ?? Number.POSITIVE_INFINITY,
          matches: [],
        };
      const ordered = this.resolveOrderedPlayers(
        match.scorePlayers,
        match.participants.map((participant) => participant.athlete),
      );
      const playerA = toSchedulePlayer(ordered.players[0]);
      const playerB = toSchedulePlayer(ordered.players[1]);
      if (!isResolvedSchedulePlayer(playerA) || !isResolvedSchedulePlayer(playerB)) {
        continue;
      }

      bucket.firstMatchTimestamp = Math.min(
        bucket.firstMatchTimestamp,
        match.matchDatetime?.getTime() ?? Number.POSITIVE_INFINITY,
      );
      bucket.matches.push({
        id: match.id,
        matchKey: this.buildScheduleMatchKey(match),
        round: match.round,
        tableNumber: match.tableNumber,
        matchDatetime: match.matchDatetime ? match.matchDatetime.toISOString() : null,
        scoreRaw: match.scoreRaw || null,
        playerA,
        playerB,
      });
      categories.set(match.category.id, bucket);
    }

    return {
      eventId: scope.canonicalEventId,
      categories: [...categories.values()]
        .sort((left, right) => {
          if (left.firstMatchTimestamp !== right.firstMatchTimestamp) {
            return left.firstMatchTimestamp - right.firstMatchTimestamp;
          }
          return left.categoryName.localeCompare(right.categoryName, "pt-BR", { sensitivity: "base" });
        })
        .map(({ firstMatchTimestamp: _firstMatchTimestamp, ...category }) => category),
    };
  }

  private selectAthletesFromSnapshot(
    snapshot: EventAthletesSnapshot,
    search: string,
    pagination: PaginationWindow,
  ) {
    const normalizedSearch = normalizeAthleteName(search);
    return snapshot.items
      .filter((athlete) => !normalizedSearch || athlete.nameNormalized.toLowerCase().includes(normalizedSearch.toLowerCase()))
      .slice(pagination.skip, pagination.skip + pagination.take)
      .map((athlete) => ({
        id: athlete.id,
        rawAthleteId: athlete.rawAthleteId,
        nameDisplay: athlete.nameDisplay,
        stateCode: athlete.stateCode,
        region: athlete.region,
        club: athlete.club
          ? {
              id: athlete.club.id,
              name: athlete.club.name,
            }
          : null,
      }));
  }

  private selectClubsFromSnapshot(
    snapshot: EventClubsSnapshot,
    search: string,
    categoryId: number | null,
    pagination: PaginationWindow,
    throwOnInvalidCategory: boolean,
  ) {
    const normalizedSearch = normalizeAthleteName(search);
    if (categoryId && throwOnInvalidCategory && !this.snapshotHasCategory(snapshot, categoryId)) {
      throw new NotFoundException("Categoria nao encontrada para o evento");
    }
    return snapshot.clubs
      .filter((club) => !normalizedSearch || normalizeAthleteName(club.normalizedName ?? club.name).includes(normalizedSearch))
      .map((club) => {
        const athleteNames = new Set(
          club.athletes
            .filter((athlete) => !categoryId || athlete.categoryIds.includes(categoryId))
            .map((athlete) => athlete.nameNormalized),
        );
        return {
          id: club.id,
          name: club.name,
          athleteCount: athleteNames.size,
        };
      })
      .filter((club) => club.athleteCount > 0)
      .slice(pagination.skip, pagination.skip + pagination.take);
  }

  private selectClubAthletesFromSnapshot(
    snapshot: EventClubsSnapshot,
    clubId: number,
    categoryId: number | null,
    throwOnInvalidCategory: boolean,
  ) {
    const club = snapshot.clubs.find((item) => item.id === clubId);
    if (!club) {
      throw new NotFoundException("Clube nao encontrado para o evento");
    }
    if (categoryId && throwOnInvalidCategory && !this.snapshotHasCategory(snapshot, categoryId)) {
      throw new NotFoundException("Categoria nao encontrada para o evento");
    }

    const dedupedAthletes = new Map<string, EventClubAthleteSnapshotItem>();
    for (const athlete of club.athletes) {
      if (categoryId && !athlete.categoryIds.includes(categoryId)) {
        continue;
      }
      const existing = dedupedAthletes.get(athlete.nameNormalized);
      if (!existing) {
        dedupedAthletes.set(athlete.nameNormalized, { ...athlete });
        continue;
      }
      existing.categoryNames = Array.from(new Set([...existing.categoryNames, ...athlete.categoryNames])).sort((left, right) =>
        left.localeCompare(right, "pt-BR", { sensitivity: "base" }),
      );
      existing.categoryIds = Array.from(new Set([...existing.categoryIds, ...athlete.categoryIds]));
    }

    return {
      club: {
        id: club.id,
        name: club.name,
        normalizedName: club.normalizedName,
      },
      athletes: [...dedupedAthletes.values()].map((athlete) => ({
        id: athlete.id,
        rawAthleteId: athlete.rawAthleteId,
        eventId: athlete.eventId,
        nameDisplay: athlete.nameDisplay,
        nameNormalized: athlete.nameNormalized,
        stateCode: athlete.stateCode,
        region: athlete.region,
        categoryNames: athlete.categoryNames,
      })),
    };
  }

  private async listClubAthletesLegacy(scope: EventScope, clubId: number, categoryId: number | null) {
    await this.ensureEvent(scope.canonicalEventId);
    const eligibleClubIds = await this.getStateCircuitEligibleClubIds();
    if (!eligibleClubIds.has(clubId)) {
      throw new NotFoundException("Clube nao encontrado para o evento");
    }
    if (categoryId) {
      await this.ensureCategoryOfEvent(scope.allEventIds, categoryId);
    }

    const club = await this.prisma.club.findFirst({
      where: {
        id: clubId,
        athletes: {
          some: {
            eventId: { in: scope.allEventIds },
            createdFromWarning: false,
            categories: categoryId
              ? {
                  some: {
                    categoryId,
                    registrationStatus: "INSCRITO",
                  },
                }
              : {
                  some: {
                    registrationStatus: "INSCRITO",
                  },
                },
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
                registrationStatus: "INSCRITO",
              },
            }
          : {
              some: {
                registrationStatus: "INSCRITO",
              },
            },
      },
      select: {
        id: true,
        eventId: true,
        nameDisplay: true,
        nameNormalized: true,
        stateCode: true,
        region: true,
        categories: {
          select: {
            registrationStatus: true,
            category: {
              select: {
                id: true,
                eventId: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: [{ eventId: "asc" }, { nameDisplay: "asc" }],
    });

    const dedupedAthletes = new Map<
      string,
      {
        id: number;
        eventId: number;
        nameDisplay: string;
        nameNormalized: string;
        stateCode: string | null;
        region: string | null;
        categoryNames: string[];
      }
    >();

    const mapCategoryName = (category: { eventId: number; name: string }) =>
      category.eventId === scope.canonicalEventId
        ? category.name
        : `${category.name}${scope.childSuffixByEventId.get(category.eventId) ?? " -X"}`;

    for (const athlete of athletes) {
      const key = athlete.nameNormalized;
      const categoryNames = Array.from(
        new Set(
          (athlete.categories ?? [])
            .map((item) => item.category)
            .filter((category): category is { id: number; eventId: number; name: string } => Boolean(category))
            .map(mapCategoryName),
        ),
      ).sort((left, right) => left.localeCompare(right, "pt-BR", { sensitivity: "base" }));

      const existing = dedupedAthletes.get(key);
      if (!existing) {
        dedupedAthletes.set(key, {
          id: athlete.id,
          eventId: athlete.eventId,
          nameDisplay: athlete.nameDisplay,
          nameNormalized: athlete.nameNormalized,
          stateCode: athlete.stateCode ?? null,
          region: athlete.region ?? null,
          categoryNames,
        });
        continue;
      }

      const merged = new Set<string>([...existing.categoryNames, ...categoryNames]);
      existing.categoryNames = Array.from(merged).sort((left, right) =>
        left.localeCompare(right, "pt-BR", { sensitivity: "base" }),
      );
    }

    const dedupedValues = Array.from(dedupedAthletes.values());
    const routeIdByAthleteId = await this.ensureStableAthleteRouteIds(
      dedupedValues.map((athlete) => ({
        eventId: athlete.eventId,
        athleteId: athlete.id,
        athleteName: athlete.nameDisplay,
        athleteNameNormalized: athlete.nameNormalized,
        clubNormalizedName: club.normalizedName,
      })),
    );

    return {
      club,
      athletes: dedupedValues.map((athlete) => ({
        ...athlete,
        rawAthleteId: athlete.id,
        id: routeIdByAthleteId.get(athlete.id) ?? athlete.id,
      })),
    };
  }

  private snapshotHasCategory(snapshot: EventClubsSnapshot, categoryId: number): boolean {
    return snapshot.clubs.some((club) => club.athletes.some((athlete) => athlete.categoryIds.includes(categoryId)));
  }

  private buildScheduleMatchKey(match: {
    id: number;
    matchKey?: string | null;
    round: string | null;
    tableNumber: string | null;
    matchDatetime: Date | null;
    scorePlayers: unknown;
  }): string {
    if (typeof match.matchKey === "string" && match.matchKey.trim()) {
      return match.matchKey;
    }
    return [
      match.id,
      match.round ?? "",
      match.tableNumber ?? "",
      match.matchDatetime?.toISOString() ?? "",
    ].join("|");
  }

  async listGlobalEfficiency(year?: number) {
    const now = Date.now();
    const cacheKey = typeof year === "number" ? `year:${year}` : "all";
    const cacheHit = this.globalEfficiencyCache.get(cacheKey);
    if (
      cacheHit &&
      cacheHit.cacheVersion === UserService.efficiencyCacheVersion &&
      cacheHit.expiresAt > now
    ) {
      return cacheHit.data;
    }

    const [rankingData, availableYears] = await Promise.all([
      this.computeEfficiencyRanking({ year }),
      this.listEfficiencyAvailableYears(),
    ]);
    const data = { ...rankingData, availableYears };
    this.globalEfficiencyCache.set(cacheKey, {
      cacheVersion: UserService.efficiencyCacheVersion,
      expiresAt: now + UserService.EFFICIENCY_CACHE_TTL_MS,
      data,
    });
    return data;
  }

  private async computeEfficiencyRanking(input: { eventIds?: number[]; year?: number }) {
    const eligibleClubIds = await this.getStateCircuitEligibleClubIds();
    if (eligibleClubIds.size === 0) {
      return { weights: await this.getEfficiencyWeights(), ranking: [] as ClubEfficiencyRow[] };
    }

    const scopedEventIds = typeof input.year === "number"
      ? await this.listEfficiencyEventIdsForYear(input.year, input.eventIds)
      : input.eventIds;
    if (typeof input.year === "number" && (scopedEventIds?.length ?? 0) === 0) {
      return { weights: await this.getEfficiencyWeights(), ranking: [] as ClubEfficiencyRow[] };
    }

    const hasScopedEvents = Array.isArray(scopedEventIds) && scopedEventIds.length > 0;
    const eventFilter = hasScopedEvents ? { eventId: { in: scopedEventIds } } : {};
    const eligibleClubFilter = { clubId: { in: [...eligibleClubIds] } };
    const athleteFilter = {
      ...eventFilter,
      ...eligibleClubFilter,
      createdFromWarning: false,
    };
    const categoryFilter =
      hasScopedEvents
        ? {
            eventId: { in: scopedEventIds },
            OR: [{ cbtmCategoryId: null }, { cbtmCategoryId: { notIn: IGNORED_CATEGORY_IDS } }],
          }
        : {
            OR: [{ cbtmCategoryId: null }, { cbtmCategoryId: { notIn: IGNORED_CATEGORY_IDS } }],
          };

    const [efficiencyWeightVersions, clubs, registeredAthletesByClub, categories] = await Promise.all([
      this.loadEfficiencyConfigVersions(),
      this.prisma.club.findMany({
        where: {
          id: { in: [...eligibleClubIds] },
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
      this.prisma.athlete.findMany({
        where: {
          ...athleteFilter,
          nameDisplay: {
            not: {
              contains: "#",
            },
          },
          categories: {
            some: {
              registrationStatus: "INSCRITO",
            },
          },
        },
        select: {
          clubId: true,
          nameNormalized: true,
        },
        distinct: ["clubId", "nameNormalized"],
      }),
      this.prisma.category.findMany({
        where: categoryFilter,
        select: {
          id: true,
          name: true,
          eventId: true,
          cbtmCategoryId: true,
        },
      }),
    ]);
    const weights = this.resolveEfficiencyWeightsFromLoadedVersions(efficiencyWeightVersions, new Date())
      ?? await this.getEfficiencyWeights();

    const eventIdsForWeights = [...new Set(categories.map((category) => category.eventId))];
    const eventsById = new Map(
      (
        await this.prisma.event.findMany({
          where: { id: { in: eventIdsForWeights } },
          select: { id: true, nivel: true, nome: true, dataInicio: true },
        })
      ).map((event) => [event.id, event]),
    );
    const categoryById = new Map(categories.map((category) => [category.id, category]));
    const officialCategoryNamesByEvent = new Map<number, Set<string>>();
    for (const category of categories) {
      const cbtmCategoryId = String((category as { cbtmCategoryId?: string | null }).cbtmCategoryId ?? "").trim();
      if (!cbtmCategoryId) {
        continue;
      }
      const bucket = officialCategoryNamesByEvent.get(category.eventId) ?? new Set<string>();
      bucket.add(category.name);
      officialCategoryNamesByEvent.set(category.eventId, bucket);
    }

    const rowsByClubId = new Map<number, ClubEfficiencyRow>();
    const athleteClubByAthleteId = new Map<number, number>();
    const medalistsByClubEvent = new Map<number, Map<number, EfficiencyEventMedalist[]>>();
    const registeredAthleteCountByClub = new Map<number, number>();

    for (const athlete of registeredAthletesByClub) {
      registeredAthleteCountByClub.set(
        athlete.clubId,
        (registeredAthleteCountByClub.get(athlete.clubId) ?? 0) + 1,
      );
    }

    for (const club of clubs) {
      rowsByClubId.set(club.id, {
        clubId: club.id,
        clubName: club.name,
        athleteCount: registeredAthleteCountByClub.get(club.id) ?? 0,
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

    const categoryIds = categories
      .filter((category) => isEfficiencyEligibleCategoryName(category.name))
      .map((category) => category.id);
    if (categoryIds.length === 0 || rowsByClubId.size === 0) {
      return { weights, ranking: [...rowsByClubId.values()] };
    }

    const [athleteCategories, fullCategoryMatchesRaw] = await Promise.all([
      this.prisma.athleteCategory.findMany({
        where: {
          categoryId: { in: categoryIds },
          registrationStatus: "INSCRITO",
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

    const categoryAthletesMap = new Map<number, Map<number, CategoryAthleteRef>>();
    const scopedAthletesPool = new Map<number, CategoryAthleteRef>();

    for (const item of athleteCategories) {
      const bucket = categoryAthletesMap.get(item.categoryId) ?? new Map<number, CategoryAthleteRef>();
      const athleteRef = {
        athleteId: item.athlete.id,
        athleteName: item.athlete.nameDisplay,
        clubId: item.athlete.clubId,
        clubName: rowsByClubId.get(item.athlete.clubId)?.clubName ?? null,
      };
      pushUniqueCategoryAthlete(bucket, athleteRef);
      pushUniqueCategoryAthlete(scopedAthletesPool, athleteRef);
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

      const athletesBucket = categoryAthletesMap.get(match.categoryId) ?? new Map<number, CategoryAthleteRef>();
      for (const participant of match.participants) {
        if (!eligibleClubIds.has(participant.athlete.clubId)) {
          continue;
        }
        const athleteRef = {
          athleteId: participant.athlete.id,
          athleteName: participant.athlete.nameDisplay,
          clubId: participant.athlete.clubId,
          clubName: participant.athlete.club?.name ?? null,
        };
        pushUniqueCategoryAthlete(athletesBucket, athleteRef);
        if (!isPlaceholderClubName(athleteRef.clubName)) {
          pushUniqueCategoryAthlete(scopedAthletesPool, athleteRef);
        }
      }
      categoryAthletesMap.set(match.categoryId, athletesBucket);
    }

    for (const categoryId of categoryIds) {
      const category = categoryById.get(categoryId);
      if (!category) {
        continue;
      }
      const categoryEvent = category ? eventsById.get(category.eventId) ?? null : null;
      const athletesInCategory = [...(categoryAthletesMap.get(categoryId)?.values() ?? [])];
      const fallbackAthletePool = [...scopedAthletesPool.values()];
      const fullCategoryMatches = fullCategoryMatchesMap.get(categoryId) ?? [];
      if (fullCategoryMatches.length === 0 && athletesInCategory.length === 0) {
        continue;
      }
      const competitiveEntries = buildCompetitiveEntriesForCategory({
        categoryId,
        categoryName: categories.find((category) => category.id === categoryId)?.name ?? null,
        athletePool: athletesInCategory,
        fallbackAthletePool,
        matches: fullCategoryMatches,
      });
      if (competitiveEntries.length === 0) {
        continue;
      }
      const medalExpectation = inferCategoryMedalExpectation(fullCategoryMatches);
      const allowDualBronze = (medalExpectation?.expectedMedalists ?? 0) >= 4;
      const woDisqualifiedAthleteIds = collectWalkoverLoserAthleteIds(fullCategoryMatches);
      const positionByAthleteId = this.computeCategoryPositionByAthleteId(
        fullCategoryMatches,
        competitiveEntries.map((athlete) => ({
          athleteId: athlete.athleteId,
          athleteName: athlete.athleteName,
        })),
      );

      const medalistsInCategory = normalizeCategoryMedalists(
        competitiveEntries.flatMap((athlete) => {
          if (woDisqualifiedAthleteIds.has(athlete.athleteId)) {
            return [];
          }
          const position = positionByAthleteId.get(athlete.athleteId) ?? null;
          const medal = resolveMedalFromPosition(position, { allowDualBronze });
          if (!medal || position === null) {
            return [];
          }
          const resolvedClub =
            isPlaceholderClubName(athlete.clubName)
              ? resolveCompositeAthleteClub(athlete.athleteName, competitiveEntries) ??
                resolveCompositeAthleteClub(athlete.athleteName, fallbackAthletePool)
              : null;
          return [{
            athleteId: athlete.athleteId,
            athleteName: athlete.athleteName,
            clubName: resolvedClub?.clubName ?? athlete.clubName ?? null,
            medalha: medal,
            position,
            unitKey: buildMedalistUnitKey({
              categoryName: fullCategoryMatches[0]?.categoryName ?? null,
              athleteId: athlete.athleteId,
              athleteName: athlete.athleteName,
            }),
          }];
        }),
      );

      for (const medalist of medalistsInCategory) {
        const athlete = competitiveEntries.find((item) => item.athleteId === medalist.athleteId);
        if (!athlete) {
          continue;
        }
        const position = positionByAthleteId.get(athlete.athleteId) ?? null;
        const medal = resolveMedalFromPosition(position, { allowDualBronze });
        if (!medal || position === null) {
          continue;
        }

        const resolvedClub =
          isPlaceholderClubName(athlete.clubName)
            ? resolveCompositeAthleteClub(athlete.athleteName, athletesInCategory) ??
              resolveCompositeAthleteClub(athlete.athleteName, fallbackAthletePool)
            : null;
        const fallbackClubId = resolvedClub?.clubId ?? (typeof athlete.clubId === "number" ? athlete.clubId : null);
        const clubId = athleteClubByAthleteId.get(athlete.athleteId) ?? fallbackClubId;
        if (!clubId) {
          continue;
        }
        const row = rowsByClubId.get(clubId);
        if (!row) {
          continue;
        }
        const clubEvents = medalistsByClubEvent.get(clubId) ?? new Map<number, EfficiencyEventMedalist[]>();
        const eventMedalists = clubEvents.get(category.eventId) ?? [];
        eventMedalists.push({
          athleteId: athlete.athleteId,
          athleteName: athlete.athleteName,
          categoryName: category.name,
          medalha: medal,
          unitKey: medalist.unitKey,
        });
        clubEvents.set(category.eventId, eventMedalists);
        medalistsByClubEvent.set(clubId, clubEvents);
      }
    }

    for (const [clubId, row] of rowsByClubId.entries()) {
      const eventsForClub = medalistsByClubEvent.get(clubId);
      if (!eventsForClub) {
        continue;
      }
      for (const [eventId, medalists] of eventsForClub.entries()) {
        const event = eventsById.get(eventId);
        const eventWeight = this.resolveEfficiencyEventWeight(event?.nivel ?? null, event?.nome ?? null);
        const eventMedalWeights = efficiencyWeightVersions
          ? this.resolveEfficiencyWeightsForDate(
              efficiencyWeightVersions,
              event?.dataInicio ?? this.resolveOldestEfficiencyVersionDate(efficiencyWeightVersions) ?? new Date(),
            )
          : weights;
        const dedupedMedalists = this.dedupeEfficiencyMedalistsByEvent(
          event?.nome ?? "",
          officialCategoryNamesByEvent.get(eventId) ?? new Set<string>(),
          medalists,
        );
        for (const medalist of dedupedMedalists) {
          row[medalist.medalha] += 1;
          row.pontuacao[medalist.medalha] += this.getEfficiencyMedalWeight(medalist.medalha, eventMedalWeights) * eventWeight;
        }
      }
    }

    for (const row of rowsByClubId.values()) {
      row.totalQuantidade = row.ouro + row.prata + row.bronze;
      row.pontuacao.total = row.pontuacao.ouro + row.pontuacao.prata + row.pontuacao.bronze;
      row.totalPontuacao = row.pontuacao.total;
    }

    const ranking = [...rowsByClubId.values()].sort((left, right) => {
      if (left.totalPontuacao !== right.totalPontuacao) {
        return right.totalPontuacao - left.totalPontuacao;
      }
      if (left.ouro !== right.ouro) {
        return right.ouro - left.ouro;
      }
      if (left.prata !== right.prata) {
        return right.prata - left.prata;
      }
      if (left.bronze !== right.bronze) {
        return right.bronze - left.bronze;
      }
      return left.clubName.localeCompare(right.clubName, "pt-BR", { sensitivity: "base" });
    });

    return { weights, ranking };
  }

  private async listEfficiencyEventIdsForYear(year: number, baseEventIds?: number[]): Promise<number[]> {
    const start = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(year + 1, 0, 1, 0, 0, 0, 0));
    const where: {
      id?: { in: number[] };
      dataInicio: { gte: Date; lt: Date };
    } = {
      dataInicio: {
        gte: start,
        lt: end,
      },
    };
    if (Array.isArray(baseEventIds) && baseEventIds.length > 0) {
      where.id = { in: baseEventIds };
    }

    const events = await this.prisma.event.findMany({
      where,
      select: { id: true, dataInicio: true },
    });
    return events.map((event) => event.id);
  }

  private async listEfficiencyAvailableYears(): Promise<number[]> {
    const events = await this.prisma.event.findMany({
      where: {
        dataInicio: {
          not: null,
        },
      },
      select: { dataInicio: true },
    });
    const years = new Set<number>();
    for (const event of events) {
      if (event.dataInicio) {
        years.add(event.dataInicio.getUTCFullYear());
      }
    }
    return [...years].sort((left, right) => right - left);
  }

  async getClubEfficiencyCareer(clubId: number) {
    const now = Date.now();
    const cacheHit = this.clubEfficiencyCache.get(clubId);
    if (
      cacheHit &&
      cacheHit.cacheVersion === UserService.efficiencyCacheVersion &&
      cacheHit.expiresAt > now
    ) {
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
          cbtmCategoryId: true,
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
    const eligibleCategories = categories
      .filter((category) => isEfficiencyEligibleCategoryName(category.name))
      .sort((left, right) => {
        const leftOfficial = left.cbtmCategoryId ? 1 : 0;
        const rightOfficial = right.cbtmCategoryId ? 1 : 0;
        if (leftOfficial !== rightOfficial) {
          return rightOfficial - leftOfficial;
        }
        return left.id - right.id;
      });
    const officialCategoryNamesByEvent = new Map<number, Set<string>>();
    for (const category of eligibleCategories) {
      if (!category.cbtmCategoryId) {
        continue;
      }
      const bucket = officialCategoryNamesByEvent.get(category.eventId) ?? new Set<string>();
      bucket.add(category.name);
      officialCategoryNamesByEvent.set(category.eventId, bucket);
    }
    const categoryById = new Map(eligibleCategories.map((category) => [category.id, category]));
    const categoryIds = eligibleCategories.map((category) => category.id);

    const athleteCategories = categoryIds.length
      ? await this.prisma.athleteCategory.findMany({
          where: {
            categoryId: { in: categoryIds },
            registrationStatus: "INSCRITO",
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

    const athleteCountByEvent = new Map<number, number>();
    const athleteNamesByEvent = new Map<number, Set<string>>();

    const clubAthletesInCategory = new Map<number, Map<number, CategoryAthleteRef>>();
    for (const row of athleteCategories) {
      const athletes = clubAthletesInCategory.get(row.categoryId) ?? new Map<number, CategoryAthleteRef>();
      pushUniqueCategoryAthlete(athletes, {
        athleteId: row.athlete.id,
        athleteName: row.athlete.nameDisplay,
        clubId: clubId,
        clubName: null,
      });
      clubAthletesInCategory.set(row.categoryId, athletes);
      const eventId = categoryById.get(row.categoryId)?.eventId;
      const normalizedAthleteName = normalizeAthleteName(row.athlete.nameDisplay);
      if (eventId && normalizedAthleteName) {
        const eventAthletes = athleteNamesByEvent.get(eventId) ?? new Set<string>();
        eventAthletes.add(normalizedAthleteName);
        athleteNamesByEvent.set(eventId, eventAthletes);
      }
    }
    for (const [eventId, athleteNames] of athleteNamesByEvent.entries()) {
      athleteCountByEvent.set(eventId, athleteNames.size);
    }

    const fullCategoryMatchesMap = new Map<number, CategoryAnalyticsMatch[]>();
    const eligibleCategoryIdSet = new Set(categoryIds);
    for (const match of fullCategoryMatchesRaw) {
      if (!eligibleCategoryIdSet.has(match.categoryId)) {
        continue;
      }
      const analytics = this.buildCategoryAnalyticsMatchFromRaw(match);
      if (!analytics) continue;
      const bucket = fullCategoryMatchesMap.get(match.categoryId) ?? [];
      bucket.push(analytics);
      fullCategoryMatchesMap.set(match.categoryId, bucket);

      const athletes = clubAthletesInCategory.get(match.categoryId) ?? new Map<number, CategoryAthleteRef>();
      for (const participant of match.participants) {
        if (participant.athlete.clubId !== clubId) {
          continue;
        }
        pushUniqueCategoryAthlete(athletes, {
          athleteId: participant.athlete.id,
          athleteName: participant.athlete.nameDisplay,
          clubId: participant.athlete.clubId,
          clubName: participant.athlete.club?.name ?? null,
        });
      }
      clubAthletesInCategory.set(match.categoryId, athletes);
    }

    const athleteNameByGroupKey = new Map<string, string>();
    const athletePrimaryIdByGroupKey = new Map<string, number>();
    const athleteEventSetByGroupKey = new Map<string, Set<number>>();
    const athleteGroupKeyById = new Map<number, string>();
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
    const contributionByAthleteEventKey = new Map<string, EfficiencyMedalCounter>();
    const medalistDedup = new Set<string>();

    for (const category of eligibleCategories) {
      const categoryAthletes = [...(clubAthletesInCategory.get(category.id)?.values() ?? [])];
      const categoryMatches = fullCategoryMatchesMap.get(category.id) ?? [];
      const competitiveEntries = buildCompetitiveEntriesForCategory({
        categoryId: category.id,
        categoryName: category.name,
        athletePool: categoryAthletes,
        fallbackAthletePool: categoryAthletes,
        matches: categoryMatches,
      });
      const clubCompetitiveEntries = competitiveEntries.filter((entry) => {
        if (entry.clubId === clubId) {
          return true;
        }
        if (athleteGroupKeyById.has(entry.athleteId)) {
          return true;
        }
        return resolveCompositeAthleteClub(entry.athleteName, categoryAthletes)?.clubId === clubId;
      });
      if (clubCompetitiveEntries.length === 0) continue;
      const medalExpectation = inferCategoryMedalExpectation(categoryMatches);
      const allowDualBronze = (medalExpectation?.expectedMedalists ?? 0) >= 4;
      const woDisqualifiedAthleteIds = collectWalkoverLoserAthleteIds(categoryMatches);
      const positionByAthleteId = this.computeCategoryPositionByAthleteId(
        categoryMatches,
        clubCompetitiveEntries.map((athlete) => ({
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

      const medalistsInCategory = normalizeCategoryMedalists(
        clubCompetitiveEntries.flatMap((athlete) => {
          if (woDisqualifiedAthleteIds.has(athlete.athleteId)) {
            return [];
          }
          const position = positionByAthleteId.get(athlete.athleteId) ?? null;
          const medal = resolveMedalFromPosition(position, { allowDualBronze });
          if (!medal || position === null) {
            return [];
          }
          return [{
            athleteId: athlete.athleteId,
            athleteName: athlete.athleteName,
            medalha: medal,
            position,
            unitKey: buildMedalistUnitKey({
              eventName: event.nome,
              categoryName: category.name,
              athleteId: athlete.athleteId,
              athleteName: athlete.athleteName,
            }),
          }];
        }),
      );

      for (const medalist of medalistsInCategory) {
        const athlete = clubCompetitiveEntries.find((item) => item.athleteId === medalist.athleteId);
        if (!athlete) {
          continue;
        }
        const position = positionByAthleteId.get(athlete.athleteId) ?? null;
        const medal = resolveMedalFromPosition(position, { allowDualBronze });
        if (!medal || position === null) continue;

        const athleteGroupKey = athleteGroupKeyById.get(athlete.athleteId) ?? `id:${athlete.athleteId}`;
        const canonicalCategoryKey = category.cbtmCategoryId
          ? `cbtm:${category.cbtmCategoryId}`
          : `id:${category.id}`;
        const unitKey = buildMedalistUnitKey({
          eventName: event.nome,
          categoryName: category.name,
          athleteId: athlete.athleteId,
          athleteName: athlete.athleteName,
        });
        const dedupKey =
          isDoublesCategoryName(category.name) || isDoublesEventName(event.nome)
            ? `${event.id}:${athleteGroupKey}:${unitKey}:${medal}`
            : `${event.id}:${canonicalCategoryKey}:${athlete.athleteId}:${medal}`;
        if (medalistDedup.has(dedupKey)) {
          continue;
        }
        medalistDedup.add(dedupKey);

        totals[medal] += 1;
        eventMedals[medal] += 1;
        historyEntry.medals[medal] += 1;

        const contribution =
          contributionByAthleteGroupKey.get(athleteGroupKey) ?? createEmptyEfficiencyMedalCounter();
        contribution[medal] += 1;
        contributionByAthleteGroupKey.set(athleteGroupKey, contribution);
        const athleteEventKey = `${athleteGroupKey}:${event.id}`;
        const contributionByEvent =
          contributionByAthleteEventKey.get(athleteEventKey) ?? createEmptyEfficiencyMedalCounter();
        contributionByEvent[medal] += 1;
        contributionByAthleteEventKey.set(athleteEventKey, contributionByEvent);

        historyEntry.medalists.push({
          athleteId: athlete.athleteId,
          athleteName:
            athleteNameByGroupKey.get(athleteGroupKeyById.get(athlete.athleteId) ?? "") ??
            athlete.athleteName,
          categoryName: categoryById.get(category.id)?.name ?? "-",
          medalha: medal,
          unitKey,
        });
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
        const dedupedMedalists = this.dedupeEfficiencyMedalistsByEvent(
          row.eventName,
          officialCategoryNamesByEvent.get(row.eventId) ?? new Set<string>(),
          row.medalists,
        );
        const medals = createEmptyEfficiencyMedalCounter();
        for (const medalist of dedupedMedalists) {
          medals[medalist.medalha] += 1;
        }
        const eventWeight = this.resolveEfficiencyCompetitionTypeWeight(row.eventType, row.eventName);
        const pontuacao = {
          ouro: medals.ouro * weights.pesoOuro * eventWeight,
          prata: medals.prata * weights.pesoPrata * eventWeight,
          bronze: medals.bronze * weights.pesoBronze * eventWeight,
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
          ouro: medals.ouro,
          prata: medals.prata,
          bronze: medals.bronze,
          totalQuantidade: totalEfficiencyMedals(medals),
          pontuacao,
          medalists: dedupedMedalists.sort((left, right) => {
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

    const recomputedContributionByGroupKey = new Map<string, EfficiencyMedalCounter>();
    const recomputedEventSetByGroupKey = new Map<string, Set<number>>();
    const recomputedPointsByGroupKey = new Map<string, { ouro: number; prata: number; bronze: number; total: number }>();
    const recomputedDisplayNameByGroupKey = new Map<string, string>();
    for (const row of history) {
      for (const medalist of row.medalists) {
        const groupKey = athleteGroupKeyById.get(medalist.athleteId) ?? `name:${normalizeAthleteName(medalist.athleteName)}`;
        const medals = recomputedContributionByGroupKey.get(groupKey) ?? createEmptyEfficiencyMedalCounter();
        medals[medalist.medalha] += 1;
        recomputedContributionByGroupKey.set(groupKey, medals);
        const currentDisplayName = recomputedDisplayNameByGroupKey.get(groupKey);
        if (!currentDisplayName || medalist.athleteName.length > currentDisplayName.length) {
          recomputedDisplayNameByGroupKey.set(groupKey, medalist.athleteName);
        }
        const eventSet = recomputedEventSetByGroupKey.get(groupKey) ?? new Set<number>();
        eventSet.add(row.eventId);
        recomputedEventSetByGroupKey.set(groupKey, eventSet);
        const points = recomputedPointsByGroupKey.get(groupKey) ?? { ouro: 0, prata: 0, bronze: 0, total: 0 };
        points[medalist.medalha] += medalist.medalha === "ouro"
          ? weights.pesoOuro * this.resolveEfficiencyCompetitionTypeWeight(row.eventType, row.eventName)
          : medalist.medalha === "prata"
            ? weights.pesoPrata * this.resolveEfficiencyCompetitionTypeWeight(row.eventType, row.eventName)
            : weights.pesoBronze * this.resolveEfficiencyCompetitionTypeWeight(row.eventType, row.eventName);
        points.total = points.ouro + points.prata + points.bronze;
        recomputedPointsByGroupKey.set(groupKey, points);
      }
    }

    const athletesContribution = [...recomputedContributionByGroupKey.entries()]
      .map(([groupKey, medals]) => {
        const pontuacao = recomputedPointsByGroupKey.get(groupKey) ?? { ouro: 0, prata: 0, bronze: 0, total: 0 };
        return {
          athleteId: athletePrimaryIdByGroupKey.get(groupKey) ?? 0,
          athleteName:
            athleteNameByGroupKey.get(groupKey) ??
            recomputedDisplayNameByGroupKey.get(groupKey) ??
            groupKey.replace(/^name:/, ""),
          eventos: recomputedEventSetByGroupKey.get(groupKey)?.size ?? 0,
          ouro: medals.ouro,
          prata: medals.prata,
          bronze: medals.bronze,
          totalQuantidade: totalEfficiencyMedals(medals),
          pontuacao,
        };
      })
      .filter((row) => row.totalQuantidade > 0)
      .sort((left, right) => {
        if (left.pontuacao.total !== right.pontuacao.total) return right.pontuacao.total - left.pontuacao.total;
        if (left.ouro !== right.ouro) return right.ouro - left.ouro;
        if (left.prata !== right.prata) return right.prata - left.prata;
        if (left.bronze !== right.bronze) return right.bronze - left.bronze;
        if (left.totalQuantidade !== right.totalQuantidade) return right.totalQuantidade - left.totalQuantidade;
        return left.athleteName.localeCompare(right.athleteName, "pt-BR", { sensitivity: "base" });
      });

    const quantityByType = new Map<EfficiencyCompetitionType, EfficiencyMedalCounter>([
      ["BRASILEIRAO", createEmptyEfficiencyMedalCounter()],
      ["COPA", createEmptyEfficiencyMedalCounter()],
      ["ESTADUAL", createEmptyEfficiencyMedalCounter()],
      ["OPEN", createEmptyEfficiencyMedalCounter()],
    ]);
    const quantidade = { ouro: 0, prata: 0, bronze: 0, total: 0 };
    for (const row of history) {
      quantidade.ouro += row.ouro;
      quantidade.prata += row.prata;
      quantidade.bronze += row.bronze;
      const bucket = quantityByType.get(row.eventType) ?? createEmptyEfficiencyMedalCounter();
      bucket.ouro += row.ouro;
      bucket.prata += row.prata;
      bucket.bronze += row.bronze;
      quantityByType.set(row.eventType, bucket);
    }
    quantidade.total = quantidade.ouro + quantidade.prata + quantidade.bronze;
    const pontuacao = {
      ouro: history.reduce((sum, row) => sum + row.pontuacao.ouro, 0),
      prata: history.reduce((sum, row) => sum + row.pontuacao.prata, 0),
      bronze: history.reduce((sum, row) => sum + row.pontuacao.bronze, 0),
      total: 0,
    };
    pontuacao.total = pontuacao.ouro + pontuacao.prata + pontuacao.bronze;

    const medalsBrasileirao = quantityByType.get("BRASILEIRAO") ?? createEmptyEfficiencyMedalCounter();
    const medalsCopa = quantityByType.get("COPA") ?? createEmptyEfficiencyMedalCounter();
    const medalsEstadual = quantityByType.get("ESTADUAL") ?? createEmptyEfficiencyMedalCounter();
    const medalsOpen = quantityByType.get("OPEN") ?? createEmptyEfficiencyMedalCounter();

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
      cacheVersion: UserService.efficiencyCacheVersion,
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
    const woDisqualifiedAthleteIds = collectWalkoverLoserAthleteIds(categoryMatches);
    for (const athlete of uniqueAthletes.values()) {
      if (woDisqualifiedAthleteIds.has(athlete.athleteId)) {
        positionByAthleteId.set(athlete.athleteId, null);
        continue;
      }
      const summary = computeCategoryClassificationSummaries(categoryMatches, {
        athleteIds: [athlete.athleteId],
        athleteName: athlete.athleteName,
        athleteNameNormalized: normalizeAthleteName(athlete.athleteName),
      })[0];
      const currentPosition = summary?.position ?? null;

      const candidateNames = new Set<string>();
      const candidateAthleteIds = new Set<number>();
      for (const match of categoryMatches) {
        for (const player of match.players) {
          if (!player) {
            continue;
          }
          const playerName = player?.name ?? null;
          if (!playerName) {
            continue;
          }
          if (areCompetitiveEntryNamesEquivalent(athlete.athleteName, playerName)) {
            candidateNames.add(playerName);
            if (typeof player.athleteId === "number" && player.athleteId > 0) {
              candidateAthleteIds.add(player.athleteId);
            }
          }
        }
      }

      const fallbackSummary = computeCategoryClassificationSummaries(categoryMatches, {
        athleteIds: [...candidateAthleteIds],
        athleteName: [...candidateNames][0] ?? athlete.athleteName,
        athleteNameNormalized: normalizeAthleteName([...candidateNames][0] ?? athlete.athleteName),
      })[0];
      const fallbackPosition = fallbackSummary?.position ?? null;

      if (
        fallbackPosition !== null &&
        (currentPosition === null || fallbackPosition < currentPosition)
      ) {
        positionByAthleteId.set(athlete.athleteId, fallbackPosition);
        continue;
      }

      positionByAthleteId.set(athlete.athleteId, currentPosition);
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
      },
      orderBy: [{ name: "asc" }],
      select: {
        id: true,
        eventId: true,
        name: true,
        normalizedName: true,
      },
    });
    const eventRulesByEventId = new Map(
      (
        await this.prisma.event.findMany({
          where: { id: { in: scope.allEventIds } },
          select: {
            id: true,
            ratingMatchFormat: true,
            competitionFormat: true,
          },
        })
      ).map((item) => [item.id, item] as const),
    );

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
    const athleteCountByCategory = new Map<number, number>();

    for (const category of categories) {
      const typedLinks = linksByCategory.get(category.id) ?? [];
      const scoped = selectAthletesByRegistrationScope(typedLinks, registrationScope);
      athleteCountByCategory.set(category.id, scoped.athletes.length);
    }

    const historicalPreferences = await this.inferHistoricalGroupPreferences({
      excludedEventIds: scope.allEventIds,
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
          matchups: [],
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
        continue;
      }

      if (!hasMinimumSimulationAthletes(athletes.length)) {
        const reason = "categoria_com_menos_de_tres_atletas";
        const warning = `Categoria com ${athletes.length} atleta(s) no escopo. Mínimo para simulação: 3.`;
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
          matchups: [],
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
        ratingMatchFormat: eventRulesByEventId.get(category.eventId)?.ratingMatchFormat ?? "RR_K1",
        competitionFormat: eventRulesByEventId.get(category.eventId)?.competitionFormat ?? "AUTO",
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
        matchups: simulation.matchups.map((matchup) => ({
          matchName: matchup.matchName,
          blockName: matchup.blockName,
          athleteA: matchup.athleteA
            ? {
                athleteId: matchup.athleteA.athleteId,
                nameDisplay: matchup.athleteA.nameDisplay,
                nameReduced: toReducedName(matchup.athleteA.nameDisplay),
                clubName: matchup.athleteA.clubName,
                rankingPoints: matchup.athleteA.rankingPoints,
                ratingPoints: matchup.athleteA.ratingPoints,
              }
            : null,
          athleteB: matchup.athleteB
            ? {
                athleteId: matchup.athleteB.athleteId,
                nameDisplay: matchup.athleteB.nameDisplay,
                nameReduced: toReducedName(matchup.athleteB.nameDisplay),
                clubName: matchup.athleteB.clubName,
                rankingPoints: matchup.athleteB.rankingPoints,
                ratingPoints: matchup.athleteB.ratingPoints,
              }
            : null,
          athleteASeed: matchup.athleteASeed,
          athleteBSeed: matchup.athleteBSeed,
          isBye: matchup.isBye,
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

    return {
      eventId: scope.canonicalEventId,
      eventSituation,
      groupsDefined,
      registrationScope,
      warnings: [],
      categories: simulations,
    };
  }

  async listClubAthletes(eventId: number, clubId: number, categoryId: number | null) {
    const scope = await this.resolveEventScope(eventId);
    if (!this.hasReadModelCacheSupport()) {
      return this.listClubAthletesLegacy(scope, clubId, categoryId);
    }
    const event = await this.ensureEvent(scope.canonicalEventId);
    const latestReliableRunId = await this.getLatestReliableScrapeRunIdForScope(scope.allEventIds);
    const snapshot = await this.resolveEventReadModelCache<EventClubsSnapshot>({
      event,
      cacheKey: this.buildReadModelKey("event-clubs-v1", scope.canonicalEventId),
      kind: "event-clubs",
      eventId: scope.canonicalEventId,
      scopeEventIds: scope.allEventIds,
      latestReliableRunId,
      buildingPayload: { eventId: scope.canonicalEventId, clubs: [], _meta: { building: true } },
      compute: () => this.buildEventClubsSnapshot(scope),
    });
    return this.selectClubAthletesFromSnapshot(snapshot, clubId, categoryId, true);
  }

  async getAthleteSummary(eventId: number, athleteId: number, orderBy: SummaryOrderBy) {
    const scope = await this.resolveEventScope(eventId);
    const event = await this.ensureEvent(scope.canonicalEventId);
    const athleteRoute = await this.resolveAthleteRouteContext(scope, athleteId);
    const routeAthleteId = athleteRoute.routeAthleteId;
    const rawAthleteId = athleteRoute.rawAthleteId;
    const normalizedOrderBy: SummaryOrderBy =
      orderBy === "category_phase_datetime" ? "category_phase_datetime" : "phase_hierarchy_datetime";
    const latestReliableRunId = await this.getLatestReliableScrapeRunIdForScope(scope.allEventIds);
    const cacheKey = this.buildReadModelKey(
      "athlete-summary",
      scope.canonicalEventId,
      routeAthleteId,
      `${normalizedOrderBy}:v3`,
    );
    return this.resolveEventReadModelCache({
      event,
      cacheKey,
      kind: "athlete-summary",
      eventId: scope.canonicalEventId,
      athleteId: routeAthleteId,
      scopeEventIds: scope.allEventIds,
      latestReliableRunId,
      compute: async () => {
      const athlete = await this.prisma.athlete.findFirst({
        where: {
          id: rawAthleteId,
          eventId: { in: scope.allEventIds },
        },
        select: {
          id: true,
          eventId: true,
          nameDisplay: true,
          nameNormalized: true,
          rankingPoints: true,
          ratingPoints: true,
          stateCode: true,
          stateName: true,
          region: true,
          club: {
            select: {
              id: true,
              name: true,
            },
          },
          categories: {
            select: {
              registrationStatus: true,
              category: {
                select: {
                  id: true,
                  eventId: true,
                  name: true,
                  cbtmCategoryId: true,
                },
              },
            },
          },
        },
      });

      if (!athlete) {
        throw new NotFoundException("Atleta nao encontrado");
      }

      const athleteNameKeys = this.buildAthleteNameKeys(athlete.nameDisplay, athlete.nameNormalized);

      const matchSelect = {
        id: true,
        eventId: true,
        categoryId: true,
        cbtmMatchId: true,
        phase: true,
        round: true,
        tableNumber: true,
        matchDatetime: true,
        scoreRaw: true,
        setsJson: true,
        scoreFinal: true,
        scoreSets: true,
        sourceFlags: true,
        p1Sets: true,
        p2Sets: true,
        winnerIndex: true,
        scorePlayers: true,
        sourceUrl: true,
        fetchedAt: true,
        matchKey: true,
        event: {
          select: {
            id: true,
            cbtmEventId: true,
            nome: true,
            nivel: true,
            dataInicio: true,
            dataFim: true,
            concluido: true,
          },
        },
        category: {
          select: {
            id: true,
            name: true,
            cbtmCategoryId: true,
          },
        },
        participants: {
          select: {
            athleteId: true,
            athlete: {
              select: {
                id: true,
                nameDisplay: true,
                club: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
        },
      } as const;

      const directMatches = await this.prisma.match.findMany({
        where: {
          eventId: { in: scope.allEventIds },
          participants: {
            some: { athleteId: rawAthleteId },
          },
        },
        select: matchSelect,
      });

      const projectedDoublesMatches = await this.prisma.match.findMany({
        where: {
          eventId: { in: scope.allEventIds },
          participants: {
            some: {
              athlete: {
                OR: [{ nameDisplay: { contains: "#" } }, { nameDisplay: { contains: " - " } }],
              },
            },
          },
        },
        select: matchSelect,
      });

      const combinedMatchesById = new Map<number, MatchWithRelations>();
      for (const match of [...directMatches, ...projectedDoublesMatches] as unknown as MatchWithRelations[]) {
        combinedMatchesById.set(match.id, match);
      }

      const matchSummaries = [...combinedMatchesById.values()]
        .map((match) => this.buildAthleteSummaryMatch(match, rawAthleteId, athleteNameKeys))
        .filter((match): match is AthleteSummaryMatch => Boolean(match));

      const deduplicated = this.deduplicateMatches(matchSummaries);
      this.sortMatches(deduplicated.matches, normalizedOrderBy);
      const categoriesWithConfirmedRegistration = athlete.categories.filter((item) =>
        item.registrationStatus === "INSCRITO" || item.registrationStatus === "PRE_INSCRITO",
      );
      const categorySource =
        categoriesWithConfirmedRegistration.length > 0
          ? categoriesWithConfirmedRegistration
          : athlete.categories;
      const analyticalCategoryIds = new Set(categorySource.map((item) => item.category.id));

      const analyticalMatches = deduplicated.matches.filter(
        (match) => !match.isProjectedParticipant && analyticalCategoryIds.has(match.category.id),
      );

      const performance = calculateAthletePointPerformance(
        analyticalMatches.map((match) => this.toMatchPerformanceInput(match)),
        {
          athleteId: rawAthleteId,
          athleteName: athlete.nameDisplay,
          athleteNameNormalized: athlete.nameNormalized,
        },
      );
      const categoryMatches = analyticalMatches.map((match) => this.toCategoryAnalyticsMatch(match));
      const performanceByCategoryRaw = computeCategoryPerformanceSummaries(categoryMatches, {
        athleteId: rawAthleteId,
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
              select: {
                id: true,
                eventId: true,
                categoryId: true,
                cbtmMatchId: true,
                phase: true,
                round: true,
                tableNumber: true,
                matchDatetime: true,
                scoreRaw: true,
                setsJson: true,
                scoreFinal: true,
                scoreSets: true,
                sourceFlags: true,
                p1Sets: true,
                p2Sets: true,
                winnerIndex: true,
                scorePlayers: true,
                sourceUrl: true,
                fetchedAt: true,
                matchKey: true,
                category: {
                  select: {
                    id: true,
                    name: true,
                    cbtmCategoryId: true,
                  },
                },
                participants: {
                  select: {
                    athleteId: true,
                    athlete: {
                      select: {
                        id: true,
                        nameDisplay: true,
                        club: {
                          select: {
                            id: true,
                            name: true,
                          },
                        },
                      },
                    },
                  },
                },
              },
            })
          : [];
      const fullCategoryMatches = (fullCategoryMatchesRaw as unknown as MatchMinimalWithRelations[])
        .map((match) => this.buildCategoryAnalyticsMatchFromRaw(match))
        .filter((item): item is CategoryAnalyticsMatch => Boolean(item));

      const classificationByCategory = computeCategoryClassificationSummaries(fullCategoryMatches, {
        athleteId: rawAthleteId,
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

      for (const item of categorySource) {
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

      const response = {
        event: {
          id: event.id,
          name: event.nome,
        },
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
          .filter((item) => categorySource.includes(item))
          .map((item) => item.category)
          .filter((category) => !category.cbtmCategoryId || !IGNORED_CATEGORY_IDS.includes(category.cbtmCategoryId))
          .filter((category, index, list) =>
            list.findIndex((candidate) => candidate.id === category.id) === index,
          )
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

      return response;
      },
    });
  }

  async listAthleteDirectory(search: string, pageRaw?: string, pageSizeRaw?: string): Promise<AthleteDirectoryRow[]> {
    const trimmedSearch = search.trim();
    const normalizedSearch = normalizeAthleteName(trimmedSearch);
    const pagination = resolvePaginationWindow(pageRaw, pageSizeRaw);
    const eligibleClubIds = await this.getStateCircuitEligibleClubIds();
    if (eligibleClubIds.size === 0) {
      return [];
    }

    const athletes = await this.prisma.athlete.findMany({
      where: {
        createdFromWarning: false,
        clubId: { in: [...eligibleClubIds] },
        nameNormalized: {
          contains: normalizedSearch || undefined,
          mode: "insensitive",
        },
      },
      select: {
        id: true,
        eventId: true,
        nameDisplay: true,
        nameNormalized: true,
      },
      orderBy: [{ nameDisplay: "asc" }],
    });

    const pairAthleteIds = athletes
      .filter((athlete) => isCompositePairName(athlete.nameDisplay))
      .map((athlete) => athlete.id);
    const pairCategoryLinks =
      pairAthleteIds.length > 0
        ? await this.prisma.athleteCategory.findMany({
            where: {
              athleteId: {
                in: pairAthleteIds,
              },
            },
            select: {
              athleteId: true,
              categoryId: true,
            },
          })
        : [];
    const categoryIdsByPairAthleteId = new Map<number, Set<number>>();
    for (const link of pairCategoryLinks) {
      const bucket = categoryIdsByPairAthleteId.get(link.athleteId) ?? new Set<number>();
      bucket.add(link.categoryId);
      categoryIdsByPairAthleteId.set(link.athleteId, bucket);
    }

    const pairEvents = athletes.filter((athlete) => isCompositePairName(athlete.nameDisplay));
    const pairEvidenceMatches =
      pairEvents.length > 0
        ? await this.prisma.match.findMany({
            where: {
              OR: [
                { winnerIndex: { not: null } },
                { p1Sets: { not: null } },
                { p2Sets: { not: null } },
              ],
              eventId: {
                in: [...new Set(pairEvents.map((athlete) => athlete.eventId))],
              },
              categoryId: {
                in: [...new Set(pairCategoryLinks.map((link) => link.categoryId))],
              },
            },
            select: {
              id: true,
              eventId: true,
              categoryId: true,
              scorePlayers: true,
              participants: {
                select: {
                  athleteId: true,
                },
              },
            },
          })
        : [];
    const pairEvidenceByAthleteId = new Set<number>();
    for (const athlete of pairEvents) {
      const categoryIds = categoryIdsByPairAthleteId.get(athlete.id);
      if (!categoryIds || categoryIds.size === 0) {
        continue;
      }
      const hasEvidence = pairEvidenceMatches.some((match) => {
        if (match.eventId !== athlete.eventId || !categoryIds.has(match.categoryId)) {
          return false;
        }
        if (match.participants.some((participant) => participant.athleteId === athlete.id)) {
          return true;
        }
        const scorePlayers = Array.isArray(match.scorePlayers)
          ? (match.scorePlayers as Array<{ name?: string | null }>)
          : [];
        return scorePlayers.some((player) => areCompetitiveEntryNamesEquivalent(player?.name, athlete.nameDisplay));
      });
      if (hasEvidence) {
        pairEvidenceByAthleteId.add(athlete.id);
      }
    }

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
      if (isCompositePairName(athlete.nameDisplay) && !pairEvidenceByAthleteId.has(athlete.id)) {
        continue;
      }
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
      .sort((a, b) => a.nameDisplay.localeCompare(b.nameDisplay, "pt-BR", { sensitivity: "base" }))
      .slice(pagination.skip, pagination.skip + pagination.take);
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
    const pairCareer = athleteRecords.some((athlete) => isCompositePairName(athlete.nameDisplay));
    const federation = athleteRecords.find((item) => item.stateCode && item.region) ?? athleteRecords[0];

    const athleteIds = athleteRecords.map((athlete) => athlete.id);
    const athleteEventIds = [...new Set(athleteRecords.map((athlete) => athlete.eventId))];
    const athleteCategoryLinks = await this.prisma.athleteCategory.findMany({
      where: {
        athleteId: {
          in: athleteIds,
        },
      },
      select: {
        categoryId: true,
      },
    });
    const athleteCategoryIds = [...new Set(athleteCategoryLinks.map((link) => link.categoryId))];
    const athleteNameKeys = this.buildAthleteNameKeys(canonicalName, normalizeAthleteName(canonicalName));
    const pairMemberKeys =
      pairCareer && isCompositePairName(canonicalName)
        ? new Set(
            splitPairNameParts(canonicalName)
              .map((part) => normalizeAthleteName(part))
              .filter((part): part is string => Boolean(part)),
          )
        : undefined;
    const matches = await this.prisma.match.findMany({
      where: pairCareer
        ? {
            OR: [
              {
                participants: {
                  some: {
                    athleteId: {
                      in: athleteIds,
                    },
                  },
                },
              },
              {
                eventId: {
                  in: athleteEventIds,
                },
                categoryId: {
                  in: athleteCategoryIds,
                },
              },
            ],
          }
        : {
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
      // Carreira de pares precisa manter confrontos de duplas e duplas mistas.
      if (!pairCareer && (isDoublesEventName(match.event?.nome) || isDoublesCategoryName(match.category?.name))) {
        continue;
      }
      const participantIds = match.participants.map((participant) => participant.athleteId);
      const matchedAthleteIds = participantIds.filter((id) => athleteIds.includes(id));
      if (!pairCareer && matchedAthleteIds.length === 0) {
        continue;
      }

      const primaryAthleteId = pairCareer ? athleteIds[0] : [...matchedAthleteIds].sort((a, b) => a - b)[0];
      const summary = this.buildAthleteSummaryMatch(
        match,
        primaryAthleteId,
        athleteNameKeys,
        pairMemberKeys,
        pairCareer ? canonicalName : undefined,
      );
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
          const bucketMatches =
            pairCareer && bucket.matches.some((match) => Boolean(match.category.cbtmCategoryId))
              ? bucket.matches.filter((match) => Boolean(match.category.cbtmCategoryId))
              : bucket.matches;
          const bucketCategories = new Map<number, { id: number; name: string }>();
          for (const match of bucketMatches) {
            bucketCategories.set(match.category.id, {
              id: match.category.id,
              name: match.category.name,
            });
          }
          const categoryIdsForClassification = [...bucketCategories.keys()];
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

          const categoryMatches = bucketMatches.map((match) => this.toCategoryAnalyticsMatch(match));
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
            categories: [...bucketCategories.values()].sort((a, b) =>
              a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }),
            ),
            matches: bucketMatches,
            performance: calculateAthletePointPerformance(
              bucketMatches.map((match) => this.toMatchPerformanceInput(match)),
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

  async getAthleteIdentity(eventId: number, athleteId: number) {
    const scope = await this.resolveEventScope(eventId);
    const event = await this.ensureEvent(scope.canonicalEventId);
    const athleteRoute = await this.resolveAthleteRouteContext(scope, athleteId);
    const routeAthleteId = athleteRoute.routeAthleteId;
    const rawAthleteId = athleteRoute.rawAthleteId;

    const athlete = await this.prisma.athlete.findFirst({
      where: {
        id: rawAthleteId,
        eventId: { in: scope.allEventIds },
      },
      select: {
        id: true,
        nameDisplay: true,
      },
    });

    if (!athlete) {
      throw new NotFoundException("Atleta nao encontrado");
    }

    return {
      event: {
        id: event.id,
        name: event.nome,
      },
      athlete: {
        id: routeAthleteId,
        rawAthleteId,
        name: athlete.nameDisplay,
        shortName: toReducedName(athlete.nameDisplay),
      },
    };
  }

  private buildAthleteSummaryMatch(
    match: MatchWithRelations,
    athleteId: number,
    athleteNameKeys?: Set<string>,
    pairMemberKeys?: Set<string>,
    canonicalPairName?: string,
  ): AthleteSummaryMatch | null {
    const participants = match.participants.map((participant) => participant.athlete);
    const ordered = this.resolveOrderedPlayers(match.scorePlayers, participants);

    const directAthleteIndex: 0 | 1 | null =
      ordered.players[0]?.id === athleteId ? 0 : ordered.players[1]?.id === athleteId ? 1 : null;
    let athleteIndex: 0 | 1 | null = directAthleteIndex;

    if (athleteIndex === null && athleteNameKeys && athleteNameKeys.size > 0) {
      athleteIndex = this.resolveProjectedAthleteIndexFromPair(
        ordered.players,
        athleteNameKeys,
        pairMemberKeys,
        canonicalPairName,
      );
    }

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
        athletePlayer && (athletePlayer.id || athleteIndex !== null)
          ? {
              id: athleteId,
              name: athletePlayer.name,
            }
          : null,
      athleteKey: athletePlayer ? normalizeAthleteName(athletePlayer.name) : null,
      isProjectedParticipant: directAthleteIndex === null && athleteIndex !== null,
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

  private buildAthleteNameKeys(nameDisplay: string, nameNormalized?: string | null): Set<string> {
    const keys = new Set<string>();
    const fullDisplay = compactWhitespace(nameDisplay);
    const reducedDisplay = toReducedName(fullDisplay);
    const candidates = [fullDisplay, reducedDisplay, nameNormalized ?? null];
    for (const candidate of candidates) {
      const compact = compactWhitespace(candidate);
      if (!compact) {
        continue;
      }
      const normalized = normalizeAthleteName(compact);
      if (normalized) {
        keys.add(normalized);
      }
    }

    if (isCompositePairName(fullDisplay)) {
      const normalizedPair = normalizeAthleteName(normalizeCompositePairName(fullDisplay));
      if (normalizedPair) {
        keys.add(normalizedPair);
      }

      for (const part of splitPairNameParts(fullDisplay)) {
        const normalizedPart = normalizeAthleteName(part);
        if (normalizedPart) {
          keys.add(normalizedPart);
        }
      }
    }

    return keys;
  }

  private resolveProjectedAthleteIndexFromPair(
    players: [AthleteSummaryPlayer | null, AthleteSummaryPlayer | null],
    athleteNameKeys: Set<string>,
    pairMemberKeys?: Set<string>,
    canonicalPairName?: string,
  ): 0 | 1 | null {
    const containsCanonicalPair = (playerName: string | null | undefined): boolean => {
      if (canonicalPairName && areCompetitiveEntryNamesEquivalent(canonicalPairName, playerName)) {
        return true;
      }
      const normalizedPair = normalizeAthleteName(normalizeCompositePairName(playerName));
      return Boolean(normalizedPair && athleteNameKeys.has(normalizedPair));
    };

    const containsAthlete = (playerName: string | null | undefined): boolean => {
      const parts = splitPairNameParts(playerName);
      if (parts.length < 2) {
        return false;
      }
      const normalizedParts = parts
        .map((part) => normalizeAthleteName(part))
        .filter((part): part is string => Boolean(part));
      if (pairMemberKeys && pairMemberKeys.size > 0) {
        return [...pairMemberKeys].every((member) => normalizedParts.includes(member));
      }
      for (const part of parts) {
        const normalized = normalizeAthleteName(part);
        if (normalized && athleteNameKeys.has(normalized)) {
          return true;
        }
      }
      return false;
    };

    const p0Pair = containsCanonicalPair(players[0]?.name);
    const p1Pair = containsCanonicalPair(players[1]?.name);
    if (p0Pair && !p1Pair) {
      return 0;
    }
    if (p1Pair && !p0Pair) {
      return 1;
    }

    const p0 = containsAthlete(players[0]?.name);
    const p1 = containsAthlete(players[1]?.name);
    if (p0 && !p1) {
      return 0;
    }
    if (p1 && !p0) {
      return 1;
    }
    return null;
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

  private async countWalkoversForEvents(eventIds: number[]): Promise<number> {
    const walkoversByEvent = await this.countWalkoversByEvent(eventIds);
    return [...walkoversByEvent.values()].reduce((sum, count) => sum + count, 0);
  }

  private async countWalkoversByCategoryIds(
    eventIds: number[],
    categoryIds: number[],
  ): Promise<Map<number, number>> {
    const byCategory = new Map<number, number>();
    if (eventIds.length === 0 || categoryIds.length === 0) {
      return byCategory;
    }

    const matches = await this.prisma.match.findMany({
      where: {
        eventId: { in: eventIds },
        categoryId: { in: categoryIds },
        phase: { in: ["GRUPOS", "RESULTADOS"] },
      },
      select: {
        categoryId: true,
        setsJson: true,
        scoreSets: true,
        scoreRaw: true,
        p1Sets: true,
        p2Sets: true,
      },
    });

    for (const match of matches) {
      const sets = this.parseSetsJson(match.setsJson);
      const scoreSets = this.parseScoreSetsJson(match.scoreSets, sets, match.scoreRaw);
      const effectiveSets = scoreSets.map((set) => ({
        p1: set.a,
        p2: set.b,
      }));
      const setsResult = this.resolveSetsResult(match.p1Sets, match.p2Sets, match.scoreRaw, effectiveSets);
      if (
        isWalkoverByStoredScore({
          sets: effectiveSets,
          setsResult,
          scoreRaw: match.scoreRaw,
        })
      ) {
        const isDoubleWalkover =
          effectiveSets.length > 0 &&
          effectiveSets.every((set) => set.p1 === 0 && set.p2 === 0) &&
          (setsResult?.p1Sets ?? -1) === 0 &&
          (setsResult?.p2Sets ?? -1) === 0;
        byCategory.set(
          match.categoryId,
          (byCategory.get(match.categoryId) ?? 0) + (isDoubleWalkover ? 2 : 1),
        );
      }
    }

    return byCategory;
  }

  private async countWalkoversByEvent(eventIds: number[]): Promise<Map<number, number>> {
    const byEvent = new Map<number, number>();
    if (eventIds.length === 0) {
      return byEvent;
    }

    const matches = await this.prisma.match.findMany({
      where: {
        eventId: { in: eventIds },
        phase: { in: ["GRUPOS", "RESULTADOS"] },
        category: {
          cbtmCategoryId: { notIn: IGNORED_CATEGORY_IDS, not: null },
        },
      },
      select: {
        eventId: true,
        setsJson: true,
        scoreSets: true,
        scoreRaw: true,
        p1Sets: true,
        p2Sets: true,
      },
    });

    for (const match of matches) {
      const sets = this.parseSetsJson(match.setsJson);
      const scoreSets = this.parseScoreSetsJson(match.scoreSets, sets, match.scoreRaw);
      const effectiveSets = scoreSets.map((set) => ({
        p1: set.a,
        p2: set.b,
      }));
      const setsResult = this.resolveSetsResult(match.p1Sets, match.p2Sets, match.scoreRaw, effectiveSets);
      if (
        isWalkoverByStoredScore({
          sets: effectiveSets,
          setsResult,
          scoreRaw: match.scoreRaw,
        })
      ) {
        const isDoubleWalkover =
          effectiveSets.length > 0 &&
          effectiveSets.every((set) => set.p1 === 0 && set.p2 === 0) &&
          (setsResult?.p1Sets ?? -1) === 0 &&
          (setsResult?.p2Sets ?? -1) === 0;
        byEvent.set(match.eventId, (byEvent.get(match.eventId) ?? 0) + (isDoubleWalkover ? 2 : 1));
      }
    }

    return byEvent;
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
      scoreRaw: match.scoreRaw,
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
      scoreRaw: match.scoreRaw,
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

    const normalizedPhase = normalizeLegacyMatchPhase(phase ?? null);
    if (normalizedPhase === "GRUPOS") {
      return 10;
    }
    if (normalizedPhase === "RESULTADOS") {
      return 80;
    }
    if (normalizedPhase === "INSCRICOES") {
      return 90;
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
    excludedEventIds: number[];
    categories: Array<{ id: number; normalizedName: string }>;
    athleteCountByCategory: Map<number, number>;
  }): Promise<Map<number, { preferredGroupCount: number | null; sampleSize: number }>> {
    const result = new Map<number, { preferredGroupCount: number | null; sampleSize: number }>();
    if (input.categories.length === 0) {
      return result;
    }

    const normalizedNames = [...new Set(input.categories.map((category) => category.normalizedName))];
    const excludedEventIds = [...new Set(input.excludedEventIds)];

    const historicalCategories = await this.prisma.category.findMany({
      where: {
        eventId: { notIn: excludedEventIds },
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

  private buildEventMergeScopeIndex(merges: EventMergeEntry[]): {
    canonicalByEventId: Map<number, number>;
    childrenByCanonicalEventId: Map<number, EventMergeEntry[]>;
  } {
    const parentBySecondaryEventId = new Map<number, number>();
    for (const merge of merges) {
      parentBySecondaryEventId.set(merge.secondaryEventId, merge.primaryEventId);
    }

    const rootCache = new Map<number, number>();
    const findRoot = (eventId: number): number => {
      const cached = rootCache.get(eventId);
      if (cached) {
        return cached;
      }

      const visited = new Set<number>();
      let current = eventId;
      while (parentBySecondaryEventId.has(current) && !visited.has(current)) {
        visited.add(current);
        current = parentBySecondaryEventId.get(current) ?? current;
      }

      const root = visited.has(current) ? Math.min(...visited, current) : current;
      rootCache.set(eventId, root);
      return root;
    };

    const canonicalByEventId = new Map<number, number>();
    const childrenByCanonicalEventId = new Map<number, EventMergeEntry[]>();

    for (const merge of merges) {
      const canonicalEventId = findRoot(merge.primaryEventId);
      canonicalByEventId.set(merge.secondaryEventId, canonicalEventId);

      const children = childrenByCanonicalEventId.get(canonicalEventId) ?? [];
      children.push(merge);
      childrenByCanonicalEventId.set(canonicalEventId, children);
    }

    return { canonicalByEventId, childrenByCanonicalEventId };
  }

  private async resolveEventScope(eventId: number): Promise<EventScope> {
    const merges = await this.loadEventMerges();
    const { canonicalByEventId, childrenByCanonicalEventId } = this.buildEventMergeScopeIndex(merges);
    const canonicalEventId = canonicalByEventId.get(eventId) ?? eventId;
    const childEntries = childrenByCanonicalEventId.get(canonicalEventId) ?? [];
    const childSuffixByEventId = new Map<number, string>();
    for (const entry of childEntries) {
      childSuffixByEventId.set(entry.secondaryEventId, entry.categorySuffix || " -X");
    }

    const allEventIds = [...new Set([canonicalEventId, ...childEntries.map((entry) => entry.secondaryEventId)])];
    return {
      canonicalEventId,
      allEventIds,
      childSuffixByEventId,
    };
  }

  private async resolveEventScopeByCanonical(canonicalEventId: number): Promise<EventScope> {
    const merges = await this.loadEventMerges();
    const { canonicalByEventId, childrenByCanonicalEventId } = this.buildEventMergeScopeIndex(merges);
    const resolvedCanonicalEventId = canonicalByEventId.get(canonicalEventId) ?? canonicalEventId;
    const childEntries = childrenByCanonicalEventId.get(resolvedCanonicalEventId) ?? [];
    const childSuffixByEventId = new Map<number, string>();
    for (const entry of childEntries) {
      childSuffixByEventId.set(entry.secondaryEventId, entry.categorySuffix || " -X");
    }

    return {
      canonicalEventId: resolvedCanonicalEventId,
      allEventIds: [
        ...new Set([resolvedCanonicalEventId, ...childEntries.map((entry) => entry.secondaryEventId)]),
      ],
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
    const scheduledPhases: Array<"GRUPOS" | "RESULTADOS"> = [
      "GRUPOS",
      "RESULTADOS",
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

  private resolveEfficiencyWeightsForDate(
    versions: EfficiencyConfigVersionLike[],
    referenceDate: Date,
  ): EfficiencyWeights {
    const sortedVersions = [...versions].sort(
      (left, right) => left.dataInicioVigencia.getTime() - right.dataInicioVigencia.getTime(),
    );
    const referenceTime = referenceDate.getTime();
    const matchingVersion = sortedVersions.find((version) => {
      const startsBeforeReference = version.dataInicioVigencia.getTime() <= referenceTime;
      const endsAfterReference = !version.dataFimVigencia || version.dataFimVigencia.getTime() >= referenceTime;
      return startsBeforeReference && endsAfterReference;
    }) ?? sortedVersions[0] ?? null;

    if (matchingVersion) {
      return {
        pesoOuro: matchingVersion.pesoOuro,
        pesoPrata: matchingVersion.pesoPrata,
        pesoBronze: matchingVersion.pesoBronze,
      };
    }

    return DEFAULT_EFFICIENCY_WEIGHTS;
  }

  private async getEfficiencyWeights(referenceDate?: Date) {
    let config:
      | {
          pesoOuro: number;
          pesoPrata: number;
          pesoBronze: number;
        }
      | null = null;

    try {
      const versions = await this.loadEfficiencyConfigVersions();
      if (versions) {
        if (versions.length === 0) {
          return DEFAULT_EFFICIENCY_WEIGHTS;
        }
        return this.resolveEfficiencyWeightsForDate(versions, referenceDate ?? new Date());
      }
    } catch {
      config = null;
    }

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

  private async loadEfficiencyConfigVersions(): Promise<EfficiencyConfigVersionLike[] | null> {
    const prismaWithEfficiencyVersion = this.prisma as unknown as {
      efficiencyConfigVersion?: {
        findMany?: (args: {
          orderBy: { dataInicioVigencia: "asc" };
          select: {
            dataInicioVigencia: boolean;
            dataFimVigencia: boolean;
            pesoOuro: boolean;
            pesoPrata: boolean;
            pesoBronze: boolean;
          };
        }) => Promise<EfficiencyConfigVersionLike[]>;
      };
    };
    return await prismaWithEfficiencyVersion.efficiencyConfigVersion?.findMany?.({
      orderBy: { dataInicioVigencia: "asc" },
      select: {
        dataInicioVigencia: true,
        dataFimVigencia: true,
        pesoOuro: true,
        pesoPrata: true,
        pesoBronze: true,
      },
    }) ?? null;
  }

  private resolveEfficiencyWeightsFromLoadedVersions(
    versions: EfficiencyConfigVersionLike[] | null,
    referenceDate: Date,
  ): EfficiencyWeights | null {
    if (!versions) {
      return null;
    }
    if (versions.length === 0) {
      return DEFAULT_EFFICIENCY_WEIGHTS;
    }
    return this.resolveEfficiencyWeightsForDate(versions, referenceDate);
  }

  private resolveOldestEfficiencyVersionDate(versions: EfficiencyConfigVersionLike[]): Date | null {
    return versions.reduce<Date | null>((oldest, version) => {
      if (!oldest || version.dataInicioVigencia.getTime() < oldest.getTime()) {
        return version.dataInicioVigencia;
      }
      return oldest;
    }, null);
  }

  private getEfficiencyMedalWeight(
    medal: "ouro" | "prata" | "bronze",
    weights: { pesoOuro: number; pesoPrata: number; pesoBronze: number } = DEFAULT_EFFICIENCY_WEIGHTS,
  ): number {
    if (medal === "ouro") return weights.pesoOuro;
    if (medal === "prata") return weights.pesoPrata;
    return weights.pesoBronze;
  }

  private resolveEfficiencyCompetitionTypeWeight(eventType: EfficiencyCompetitionType, eventName?: string | null): number {
    switch (eventType) {
      case "ESTADUAL":
        return CBTM_RULES_CONFIG.ratingEventWeights.ESTADUAL;
      case "BRASILEIRAO":
        return CBTM_RULES_CONFIG.ratingEventWeights.BRASILEIRAO;
      case "OPEN":
        return CBTM_RULES_CONFIG.ratingEventWeights.REGIONAL;
      case "COPA":
        return this.resolveCopaEventWeight(eventName);
      default:
        return 1;
    }
  }

  private resolveEfficiencyEventWeight(level: EfficiencyEventLevel, eventName?: string | null): number {
    if (level === "ESTADUAL") return CBTM_RULES_CONFIG.ratingEventWeights.ESTADUAL;
    if (level === "NACIONAL") return CBTM_RULES_CONFIG.ratingEventWeights.BRASILEIRAO;
    if (level === "OPEN") return CBTM_RULES_CONFIG.ratingEventWeights.REGIONAL;
    if (level === "COPA") return this.resolveCopaEventWeight(eventName);
    return 1;
  }

  private resolveCopaEventWeight(eventName?: string | null): number {
    const normalized = normalizeText(eventName ?? "");
    if (normalized.includes("ouro")) return CBTM_RULES_CONFIG.ratingEventWeights.COPA_BRASIL_OURO;
    if (normalized.includes("prata")) return CBTM_RULES_CONFIG.ratingEventWeights.COPA_BRASIL_PRATA;
    return CBTM_RULES_CONFIG.ratingEventWeights.COPA_BRASIL_PRATA;
  }

  private dedupeEfficiencyMedalistsByEvent<T extends EfficiencyEventMedalist>(
    eventName: string,
    officialCategoryNames: Set<string>,
    medalists: T[],
  ): T[] {
    const medalistsByKey = new Map<string, T>();
    for (const medalist of medalists) {
      const dedupKey =
        isDoublesEventName(eventName) || isDoublesCategoryName(medalist.categoryName)
          ? `pair:${normalizeAthleteName(normalizeCompositePairName(medalist.athleteName))}:${medalist.medalha}`
          : `athlete:${medalist.athleteId}:${normalizeText(medalist.categoryName)}:${medalist.medalha}`;
      const existing = medalistsByKey.get(dedupKey);
      if (!existing) {
        medalistsByKey.set(dedupKey, medalist);
        continue;
      }
      const existingOfficial = officialCategoryNames.has(existing.categoryName);
      const currentOfficial = officialCategoryNames.has(medalist.categoryName);
      if (currentOfficial && !existingOfficial) {
        medalistsByKey.set(dedupKey, medalist);
      }
    }
    return [...medalistsByKey.values()];
  }

  private buildEventAthleteKey(nameNormalized: string, clubNormalizedName: string | null): string {
    const normalizedClub = normalizeText(clubNormalizedName ?? "") || "sem-clube";
    return `${nameNormalized}|${normalizedClub}`;
  }

  private async ensureStableAthleteRouteIds(
    rows: Array<{
      eventId: number;
      athleteId: number;
      athleteName: string;
      athleteNameNormalized: string;
      clubNormalizedName: string | null;
    }>,
  ): Promise<Map<number, number>> {
    const byAthleteId = new Map<number, number>();
    for (const row of rows) {
      if (typeof row.athleteId === "number") {
        byAthleteId.set(row.athleteId, row.athleteId);
      }
    }

    return byAthleteId;
  }

  private async resolveAthleteRouteContext(
    scope: EventScope,
    athleteRouteId: number,
  ): Promise<ResolvedAthleteRouteContext> {
    const legacyAthlete = await this.prisma.athlete.findFirst({
      where: {
        id: athleteRouteId,
        eventId: { in: scope.allEventIds },
      },
      select: {
        id: true,
        eventId: true,
        nameDisplay: true,
        nameNormalized: true,
        club: {
          select: {
            normalizedName: true,
          },
        },
      },
    });

    if (!legacyAthlete) {
      throw new NotFoundException("Atleta nao encontrado");
    }

    await this.ensureStableAthleteRouteIds([
      {
        eventId: legacyAthlete.eventId,
        athleteId: legacyAthlete.id,
        athleteName: legacyAthlete.nameDisplay,
        athleteNameNormalized: legacyAthlete.nameNormalized,
        clubNormalizedName: legacyAthlete.club?.normalizedName ?? null,
      },
    ]);

    return {
      routeAthleteId: athleteRouteId,
      rawAthleteId: legacyAthlete.id,
    };
  }

  private buildReadModelKey(kind: string, eventId: number, athleteId?: number, variant?: string): string {
    const keyParts = [kind, `event:${eventId}`];
    if (typeof athleteId === "number") {
      keyParts.push(`athlete:${athleteId}`);
    }
    if (variant) {
      keyParts.push(`variant:${variant}`);
    }
    return keyParts.join("|");
  }

  private getReadModelCacheReader():
    | {
        findUnique: (args: {
          where: { key: string };
          select: { sourceScrapeRunId: true; payload: true; updatedAt: true };
        }) => Promise<{ sourceScrapeRunId: number | null; payload: unknown; updatedAt: Date } | null>;
      }
    | null {
    return ((this.prisma as unknown as { readModelCache?: unknown }).readModelCache ?? null) as
      | {
        findUnique: (args: {
          where: { key: string };
          select: { sourceScrapeRunId: true; payload: true; updatedAt: true };
        }) => Promise<{ sourceScrapeRunId: number | null; payload: unknown; updatedAt: Date } | null>;
        }
      | null;
  }

  private getReadModelCacheWriter():
    | {
        upsert: (args: {
          where: { key: string };
          create: {
            key: string;
            kind: string;
            eventId: number;
            athleteId?: number;
            sourceScrapeRunId: number | null;
            payload: Prisma.InputJsonValue;
          };
          update: {
            sourceScrapeRunId: number | null;
            payload: Prisma.InputJsonValue;
          };
        }) => Promise<unknown>;
      }
    | null {
    return ((this.prismaWrite as unknown as { readModelCache?: unknown }).readModelCache ?? null) as
      | {
          upsert: (args: {
            where: { key: string };
            create: {
              key: string;
              kind: string;
              eventId: number;
              athleteId?: number;
              sourceScrapeRunId: number | null;
              payload: Prisma.InputJsonValue;
            };
            update: {
              sourceScrapeRunId: number | null;
              payload: Prisma.InputJsonValue;
            };
          }) => Promise<unknown>;
        }
      | null;
  }

  private async loadReadModelCachePayload<T>(
    readCache:
      | {
          findUnique: (args: {
            where: { key: string };
            select: { sourceScrapeRunId: true; payload: true; updatedAt: true };
          }) => Promise<{ sourceScrapeRunId: number | null; payload: unknown; updatedAt: Date } | null>;
        }
      | null,
    key: string,
  ): Promise<{ sourceScrapeRunId: number | null; payload: T | null; updatedAt: Date | null } | null> {
    if (!readCache) {
      return null;
    }
    const cached = await readCache.findUnique({
      where: { key },
      select: {
        sourceScrapeRunId: true,
        payload: true,
        updatedAt: true,
      },
    });
    if (!cached) {
      return null;
    }
    return {
      sourceScrapeRunId: cached.sourceScrapeRunId ?? null,
      payload: (cached.payload ?? null) as T | null,
      updatedAt: cached.updatedAt ?? null,
    };
  }

  private async resolveEventReadModelCache<T extends Record<string, unknown>>(input: {
    event: {
      concluido: boolean;
      lastScrapeAt?: Date | null;
      scrapeLockedAt?: Date | null;
      inicioInscricoes: Date | null;
      fimInscricoes: Date | null;
      inicioRealizacao: Date | null;
      fimRealizacao: Date | null;
      dataInicio: Date | null;
      dataFim: Date | null;
    };
    cacheKey: string;
    kind: string;
    eventId: number;
    scopeEventIds?: number[];
    athleteId?: number;
    latestReliableRunId: number | null;
    buildingPayload?: T;
    publishMode?: ReadModelPublishMode;
    compute: () => Promise<T>;
  }): Promise<T & { _meta?: Record<string, unknown> }> {
    const readCache = this.getReadModelCacheReader();
    const writeCache = this.getReadModelCacheWriter();
    const cached = await this.loadReadModelCachePayload<T>(readCache, input.cacheKey);
    const runActive = await this.isScopeScrapeLockActive(input.scopeEventIds ?? [input.eventId], input.event.scrapeLockedAt ?? null);

    if (runActive) {
      if (cached?.payload) {
        return cached.payload;
      }
      return input.buildingPayload ?? ({ _meta: { building: true } } as unknown as T);
    }

    if (
      cached &&
      cached.payload &&
      (input.latestReliableRunId === null || cached.sourceScrapeRunId === input.latestReliableRunId) &&
      this.isReadCacheFresh(input.event, cached.updatedAt)
    ) {
      return cached.payload;
    }

    try {
      const payload = await input.compute();
      const publishedPayload = await this.persistReadModelCachePayload(writeCache, {
        key: input.cacheKey,
        kind: input.kind,
        eventId: input.eventId,
        athleteId: input.athleteId,
        sourceScrapeRunId: input.latestReliableRunId,
        payload,
        mode: input.publishMode ?? getReadModelPublishMode(),
      });
      return publishedPayload;
    } catch (error) {
      if (cached?.payload) {
        return {
          ...cached.payload,
          _meta: {
            isStale: true,
            staleReason: "compute_failed",
          },
        };
      }
      throw error;
    }
  }

  private isEventScrapeLockActive(scrapeLockedAt: Date | null): boolean {
    if (!scrapeLockedAt) {
      return false;
    }
    return Date.now() - scrapeLockedAt.getTime() <= SCRAPE_LOCK_STALE_MS;
  }

  private async isScopeScrapeLockActive(eventIds: number[], fallbackScrapeLockedAt: Date | null): Promise<boolean> {
    if (this.isEventScrapeLockActive(fallbackScrapeLockedAt)) {
      return true;
    }
    const uniqueEventIds = [...new Set(eventIds.filter((eventId) => Number.isFinite(eventId)))];
    if (uniqueEventIds.length <= 1 || !("event" in this.prisma) || !this.prisma.event) {
      return false;
    }
    const lockedEvents = await this.prisma.event.findMany({
      where: {
        id: { in: uniqueEventIds },
        scrapeLockedAt: { not: null },
      },
      select: {
        scrapeLockedAt: true,
      },
    });
    return lockedEvents.some((event) => this.isEventScrapeLockActive(event.scrapeLockedAt ?? null));
  }

  private isReadCacheFresh(
    event: {
      concluido: boolean;
      inicioInscricoes: Date | null;
      fimInscricoes: Date | null;
      inicioRealizacao: Date | null;
      fimRealizacao: Date | null;
      dataInicio: Date | null;
      dataFim: Date | null;
    },
    cachedUpdatedAt: Date | null,
  ): boolean {
    if (!cachedUpdatedAt) {
      return false;
    }

    const policy = buildEventScrapePolicy({
      ...event,
    }, {
      intervalBySituationMs: SCRAPE_INTERVAL_BY_SITUATION_MS,
    });
    const dynamicMaxAgeMs = computeEventCacheMaxAgeMs(policy, SCRAPE_CACHE_TIMING);

    return Date.now() - cachedUpdatedAt.getTime() <= Math.max(10_000, dynamicMaxAgeMs);
  }

  private async getStateCircuitEligibleClubIds(): Promise<Set<number>> {
    const now = Date.now();
    if (this.stateCircuitEligibilityCache && this.stateCircuitEligibilityCache.expiresAt > now) {
      return this.stateCircuitEligibilityCache.clubIds;
    }

    const clubs = await this.prisma.club.findMany({
      where: {
        athletes: {
          some: {
            createdFromWarning: false,
            event: {
              nivel: { in: [...STATE_CIRCUIT_EVENT_LEVELS] },
            },
          },
        },
      },
      select: { id: true },
    });

    const clubIds = new Set<number>(clubs.map((club) => club.id));
    this.stateCircuitEligibilityCache = {
      expiresAt: now + Math.max(30_000, STATE_CIRCUIT_ELIGIBILITY_CACHE_TTL_MS),
      clubIds,
    };
    return clubIds;
  }

  private async persistReadModelCachePayload<T extends Record<string, unknown>>(
    writeCache:
      | {
          upsert: (args: {
            where: { key: string };
            create: {
              key: string;
              kind: string;
              eventId: number;
              athleteId?: number;
              sourceScrapeRunId: number | null;
              payload: Prisma.InputJsonValue;
            };
            update: {
              sourceScrapeRunId: number | null;
              payload: Prisma.InputJsonValue;
            };
          }) => Promise<unknown>;
        }
      | null,
    input: {
      key: string;
      kind: string;
      eventId: number;
      athleteId?: number;
      sourceScrapeRunId: number | null;
      payload: T;
      mode: ReadModelPublishMode;
    },
  ): Promise<T> {
    if (!writeCache) {
      return input.payload;
    }

    const current = await this.loadReadModelCachePayload<T>(this.getReadModelCacheReader(), input.key);
    const publication = publishReadModelPayload({
      kind: input.kind,
      current: current?.payload ?? null,
      candidate: input.payload,
      mode: input.mode,
    });

    await writeCache.upsert({
      where: { key: input.key },
        create: {
          key: input.key,
          kind: input.kind,
          eventId: input.eventId,
          ...(typeof input.athleteId === "number" ? { athleteId: input.athleteId } : {}),
          sourceScrapeRunId: input.sourceScrapeRunId,
          payload: publication.payload as Prisma.InputJsonValue,
        },
      update: {
        sourceScrapeRunId: input.sourceScrapeRunId,
        payload: publication.payload as Prisma.InputJsonValue,
      },
    });
    return publication.payload as T;
  }

  private async getLatestReliableScrapeRunIdForScope(eventIds: number[]): Promise<number | null> {
    if (eventIds.length === 0) {
      return null;
    }
    if (!("scrapeRun" in this.prisma) || !this.prisma.scrapeRun) {
      return null;
    }
    const latest = await this.prisma.scrapeRun.findFirst({
      where: {
        eventId: { in: eventIds },
        status: { in: ["SUCCESS", "PARTIAL"] },
        finishedAt: { not: null },
      },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
      },
    });

    return latest?.id ?? null;
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
