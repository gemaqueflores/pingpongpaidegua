import {
  AthleteResolverCandidate,
  EventSituation,
  ParsedDataset,
  ParsedMatch,
  ParsedMatchSet,
  compactWhitespace,
  computeEventSituation,
  normalizeRegistrationStatus,
  normalizeText,
  resolveAthleteCandidate,
} from "@cbtm/shared";
import { AliasSource, Athlete, EventLevel, MatchPhase, Prisma, RegistrationStatus } from "@prisma/client";
import { prisma } from "../prisma";
import { inferAthleteFederationFromClub } from "./athlete-federation";
import { mergeMatchesAcrossSources } from "./match-merge";
import {
  computeEventRegistrationPairRemovals,
  shouldAllowDestructiveRegistrationSync,
  shouldSyncRegistrationSnapshot,
} from "./registration-snapshot";
import { parseScoreRaw } from "./score-parser";

interface UpsertResult {
  inserted: Record<string, number>;
  updated: Record<string, number>;
  warnings: string[];
  extractionStats: ParsedDataset["extractionStats"];
}

interface UpsertOptions {
  processRegistrations?: boolean;
}

interface CachedClub {
  id: number;
  name: string;
  normalizedName: string;
}

interface CachedCategory {
  id: number;
  name: string;
  normalizedName: string;
  cbtmCategoryId: string | null;
}

interface CachedAthlete {
  id: number;
  eventId: number;
  clubId: number;
  clubNormalizedName: string | null;
  stateCode: string | null;
  stateName: string | null;
  region: string | null;
  nameDisplay: string;
  nameNormalized: string;
  rankingPoints: number | null;
  ratingPoints: number | null;
  createdFromWarning: boolean;
  aliases: Set<string>;
}

interface CachedConflict {
  id: number;
  context: string;
  shortNameNormalized: string;
  resolvedAthleteId: number | null;
  candidateAthletes: unknown;
}

const IGNORED_CATEGORY_IDS = new Set(["88888888", "99999999"]);

function toRegistrationStatus(status: string | null | undefined): RegistrationStatus | null {
  const normalized = normalizeRegistrationStatus(status);
  if (normalized === "INSCRITO") {
    return "INSCRITO";
  }
  if (normalized === "PRE_INSCRITO") {
    return "PRE_INSCRITO";
  }
  if (normalized === "OUTRO") {
    return "OUTRO";
  }
  return null;
}

interface ResolveMatchAthleteInput {
  eventId: number;
  categoryId: number;
  side: "A" | "B";
  matchKey: string;
  categoryName: string;
  shortName: string;
  rankingPoints: number | null;
  ratingPoints: number | null;
  clubNormalizedName: string | null;
  inserted: Record<string, number>;
  updated: Record<string, number>;
  warnings: string[];
  athletesById: Map<number, CachedAthlete>;
  aliasToAthleteIds: Map<string, Set<number>>;
  conflictsByKey: Map<string, CachedConflict>;
  categoryAthleteIds: Set<number> | null;
  participantRefType?: "REAL" | "GROUP_SLOT" | "WINNER_SLOT";
}

interface ObservedRegistrationCategoryStats {
  categoryName: string;
  total: number;
  inscrito: number;
  preInscrito: number;
  outro: number;
  unknown: number;
}

function inc(target: Record<string, number>, key: string): void {
  target[key] = (target[key] ?? 0) + 1;
}

function conflictCacheKey(context: string, shortNameNormalized: string): string {
  return `${context}|${shortNameNormalized}`;
}

function toOptionalInt(value: number | null | undefined): number | null {
  return Number.isInteger(value) ? (value as number) : null;
}

function mergePointValue(current: number | null, observed: number | null): number | null {
  const currentInt = Number.isInteger(current) ? Number(current) : null;
  const observedInt = Number.isInteger(observed) ? Number(observed) : null;

  if (observedInt === null) {
    return currentInt;
  }
  if (currentInt === null) {
    return observedInt;
  }

  return Math.max(currentInt, observedInt);
}

function buildRegistrationAliases(input: {
  nameDisplay: string;
  nameNormalized: string;
}): Array<{ aliasDisplay: string; aliasNormalized: string }> {
  const normalizedTokens = input.nameNormalized.split(/[^a-z0-9]+/g).filter(Boolean);
  if (normalizedTokens.length < 2) {
    return [];
  }

  const displayTokens = compactWhitespace(input.nameDisplay)
    .split(/[\s.]+/g)
    .filter(Boolean);
  const firstDisplay = displayTokens[0] ?? displayTokens[displayTokens.length - 1] ?? "";
  const lastDisplay = displayTokens[displayTokens.length - 1] ?? firstDisplay;
  const originalNormalized = normalizeText(input.nameNormalized);

  const aliases: Array<{ aliasDisplay: string; aliasNormalized: string }> = [];
  const pushAlias = (aliasNormalized: string, aliasDisplay: string) => {
    const normalizedAlias = normalizeText(aliasNormalized);
    if (!normalizedAlias || normalizedAlias === originalNormalized) {
      return;
    }
    if (aliases.some((alias) => alias.aliasNormalized === normalizedAlias)) {
      return;
    }
    aliases.push({
      aliasDisplay: compactWhitespace(aliasDisplay || aliasNormalized),
      aliasNormalized: normalizedAlias,
    });
  };

  pushAlias(
    `${normalizedTokens[0]} ${normalizedTokens[normalizedTokens.length - 1]}`,
    `${firstDisplay} ${lastDisplay}`,
  );

  const penultimate = normalizedTokens[normalizedTokens.length - 2];
  if (["de", "da", "do", "dos", "das"].includes(penultimate)) {
    const penultimateDisplay =
      displayTokens.length >= 2 ? displayTokens[displayTokens.length - 2] : penultimate;
    pushAlias(
      `${normalizedTokens[0]} ${penultimate} ${normalizedTokens[normalizedTokens.length - 1]}`,
      `${firstDisplay} ${penultimateDisplay} ${lastDisplay}`,
    );
  }

  return aliases;
}

function toReducedAliasNormalized(nameDisplay: string): string {
  const tokens = compactWhitespace(nameDisplay)
    .split(/[\s.]+/g)
    .filter(Boolean);
  if (tokens.length === 0) {
    return "";
  }
  if (tokens.length === 1) {
    return normalizeText(tokens[0]);
  }
  return normalizeText(`${tokens[0]} ${tokens[tokens.length - 1]}`);
}

function isBracketReferenceToken(value: string): boolean {
  const normalized = compactWhitespace(value ?? "");
  if (!normalized) {
    return false;
  }
  if (/^\d{1,2}\s*-\s*\d{1,2}$/.test(normalized)) {
    return true;
  }
  if (/^[vVwW]\s*\d{1,3}$/.test(normalized)) {
    return true;
  }
  return false;
}

interface DedupedMatchesResult {
  matches: ParsedMatch[];
  removed: number;
  droppedMatchKeys: string[];
}

function getMatchCategoryKey(match: ParsedMatch): string {
  if (match.categoryId) {
    return `id:${match.categoryId}`;
  }
  return `name:${match.categoryNormalizedName}`;
}

function getMatchParticipantsKey(match: ParsedMatch): string {
  const athleteA = match.athleteANormalizedName || normalizeText(match.athleteAName);
  const athleteB = match.athleteBNormalizedName || normalizeText(match.athleteBName);
  return [athleteA, athleteB].sort().join("|");
}

function parseIsoDate(input: string | null): Date | null {
  if (!input) {
    return null;
  }
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getMatchDay(match: ParsedMatch): string | null {
  const datetime = parseIsoDate(match.matchDatetime);
  if (!datetime) {
    return null;
  }
  return datetime.toISOString().slice(0, 10);
}

function getMatchTimestamp(match: ParsedMatch): string | null {
  const datetime = parseIsoDate(match.matchDatetime);
  if (!datetime) {
    return null;
  }
  return datetime.toISOString();
}

function extractGameIdFromRound(round: string | null | undefined): string | null {
  const normalized = normalizeText(round ?? "");
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

function extractGameIdFromMetadata(match: ParsedMatch): string | null {
  const rawFromMetadata =
    (typeof match.metadata?.gameId === "string" ? match.metadata.gameId : null) ??
    (typeof match.metadata?.jogo === "string" ? match.metadata.jogo : null) ??
    (typeof match.metadata?.jogo === "number" ? String(match.metadata.jogo) : null);

  const normalized = compactWhitespace(rawFromMetadata ?? "");
  if (!normalized) {
    return null;
  }

  const digits = normalized.match(/\d+/)?.[0] ?? null;
  if (!digits) {
    return null;
  }

  return String(Number(digits));
}

function extractGameId(match: ParsedMatch): string | null {
  return extractGameIdFromMetadata(match) ?? extractGameIdFromRound(match.round);
}

function getRoundSpecificity(round: string | null | undefined): number {
  const normalized = normalizeText(round ?? "");
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

function getRoundHierarchyOrder(round: string | null | undefined, phase: ParsedMatch["phase"]): number {
  const normalized = normalizeText(round ?? "");

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

  if (phase === "GRUPOS") {
    return 10;
  }
  if (phase === "ELIMINATORIA") {
    return 80;
  }
  if (phase === "RESULTADOS") {
    return 90;
  }
  if (phase === "INSCRICOES") {
    return 100;
  }

  return 999;
}

function sanitizeParsedMatchSets(sets: ParsedMatch["sets"]): ParsedMatchSet[] {
  const safeSets: ParsedMatchSet[] = [];
  for (const set of sets ?? []) {
    const p1 = Number(set?.p1);
    const p2 = Number(set?.p2);
    if (!Number.isFinite(p1) || !Number.isFinite(p2)) {
      continue;
    }
    if (p1 < 0 || p2 < 0) {
      continue;
    }
    safeSets.push({
      p1: Number(p1),
      p2: Number(p2),
    });
  }
  return safeSets;
}

function parseSetsResultFromScoreRaw(scoreRaw: string | null | undefined): { p1Sets: number; p2Sets: number } | null {
  const parsed = parseScoreRaw(scoreRaw);
  if (!parsed?.final) {
    return null;
  }

  return {
    p1Sets: parsed.final.setsA,
    p2Sets: parsed.final.setsB,
  };
}

function parseStoredSetsJson(raw: Prisma.JsonValue | null): Array<{ p1: number; p2: number }> {
  if (!Array.isArray(raw)) {
    return [];
  }

  const parsed: Array<{ p1: number; p2: number }> = [];
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
    parsed.push({ p1, p2 });
  }

  return parsed;
}

function parseStoredScoreSets(raw: Prisma.JsonValue | null): Array<{ set: number; a: number; b: number }> {
  if (!Array.isArray(raw)) {
    return [];
  }

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

  return parsed;
}

function parseStoredScoreFinal(raw: Prisma.JsonValue | null): { p1Sets: number; p2Sets: number } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const value = raw as { setsA?: unknown; setsB?: unknown };
  const setsA = Number(value.setsA);
  const setsB = Number(value.setsB);
  if (!Number.isFinite(setsA) || !Number.isFinite(setsB)) {
    return null;
  }

  return {
    p1Sets: setsA,
    p2Sets: setsB,
  };
}

function parseStoredSourceFlags(
  raw: Prisma.JsonValue | null,
): { resultados: boolean; eliminatoria: boolean } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const value = raw as { resultados?: unknown; eliminatoria?: unknown };
  const parsed = {
    resultados: Boolean(value.resultados),
    eliminatoria: Boolean(value.eliminatoria),
  };

  if (!parsed.resultados && !parsed.eliminatoria) {
    return null;
  }
  return parsed;
}

function inferSetsResultFromSets(
  sets: Array<{ p1: number; p2: number }>,
): { p1Sets: number; p2Sets: number } | null {
  if (sets.length === 0) {
    return null;
  }

  let p1Sets = 0;
  let p2Sets = 0;
  for (const set of sets) {
    if (set.p1 > set.p2) {
      p1Sets += 1;
    } else if (set.p2 > set.p1) {
      p2Sets += 1;
    }
  }

  if (p1Sets === 0 && p2Sets === 0) {
    return null;
  }

  return { p1Sets, p2Sets };
}

function getScoreRawQuality(scoreRaw: string | null | undefined): number {
  const parsed = parseScoreRaw(scoreRaw);
  const normalized = compactWhitespace(scoreRaw ?? "");
  let quality = normalized.length;

  if (parsed?.final) {
    quality += 100;
  }
  if ((parsed?.sets?.length ?? 0) > 0) {
    quality += 200 + (parsed?.sets.length ?? 0) * 10;
  }

  return quality;
}

function resolveWinnerIndex(match: ParsedMatch): 0 | 1 | null {
  if (match.winnerIndex === 0 || match.winnerIndex === 1) {
    return match.winnerIndex;
  }

  if (match.setsResult) {
    if (match.setsResult.p1Sets > match.setsResult.p2Sets) {
      return 0;
    }
    if (match.setsResult.p2Sets > match.setsResult.p1Sets) {
      return 1;
    }
  }

  const sets = sanitizeParsedMatchSets(match.sets);
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

    if (p1Wins > p2Wins) {
      return 0;
    }
    if (p2Wins > p1Wins) {
      return 1;
    }
  }

  return null;
}

function selectPreferredMatch(a: ParsedMatch, b: ParsedMatch): ParsedMatch {
  const setsCountA = sanitizeParsedMatchSets(a.sets).length;
  const setsCountB = sanitizeParsedMatchSets(b.sets).length;
  if (setsCountA !== setsCountB) {
    return setsCountA > setsCountB ? a : b;
  }

  const specificityA = getRoundSpecificity(a.round);
  const specificityB = getRoundSpecificity(b.round);
  if (specificityA !== specificityB) {
    return specificityA > specificityB ? a : b;
  }

  const hierarchyA = getRoundHierarchyOrder(a.round, a.phase);
  const hierarchyB = getRoundHierarchyOrder(b.round, b.phase);
  if (hierarchyA !== hierarchyB) {
    return hierarchyA < hierarchyB ? a : b;
  }

  const hasDatetimeA = Boolean(parseIsoDate(a.matchDatetime));
  const hasDatetimeB = Boolean(parseIsoDate(b.matchDatetime));
  if (hasDatetimeA !== hasDatetimeB) {
    return hasDatetimeA ? a : b;
  }

  return a.matchKey.localeCompare(b.matchKey) <= 0 ? a : b;
}

function deduplicateMatchesByKey(
  matches: ParsedMatch[],
  buildKey: (match: ParsedMatch) => string | null,
): DedupedMatchesResult {
  const map = new Map<string, ParsedMatch>();
  const dropped = new Set<string>();

  for (const match of matches) {
    const key = buildKey(match) ?? `match:${match.matchKey}`;
    const current = map.get(key);

    if (!current) {
      map.set(key, match);
      continue;
    }

    const preferred = selectPreferredMatch(current, match);
    const discarded = preferred.matchKey === current.matchKey ? match : current;
    dropped.add(discarded.matchKey);
    map.set(key, preferred);
  }

  const selectedMatchKeys = new Set([...map.values()].map((item) => item.matchKey));
  const droppedMatchKeys = [...dropped].filter((matchKey) => !selectedMatchKeys.has(matchKey));

  return {
    matches: [...map.values()],
    removed: matches.length - map.size,
    droppedMatchKeys,
  };
}

function deduplicateParsedMatches(matches: ParsedMatch[]): DedupedMatchesResult {
  const firstPass = deduplicateMatchesByKey(matches, (match) => {
    const day = getMatchDay(match);
    const gameId = extractGameId(match);
    if (!day || !gameId) {
      return null;
    }

    return [getMatchCategoryKey(match), getMatchParticipantsKey(match), day, `game:${gameId}`].join("|");
  });

  const secondPass = deduplicateMatchesByKey(firstPass.matches, (match) => {
    const timestamp = getMatchTimestamp(match);
    if (!timestamp) {
      return null;
    }

    return [
      getMatchCategoryKey(match),
      getMatchParticipantsKey(match),
      timestamp,
      match.tableNumber ?? "sem-mesa",
      normalizeText(match.scoreRaw),
    ].join("|");
  });

  const finalMatchKeys = new Set(secondPass.matches.map((match) => match.matchKey));
  const droppedMatchKeys = [...new Set([...firstPass.droppedMatchKeys, ...secondPass.droppedMatchKeys])].filter(
    (matchKey) => !finalMatchKeys.has(matchKey),
  );

  return {
    matches: secondPass.matches,
    removed: firstPass.removed + secondPass.removed,
    droppedMatchKeys,
  };
}

export class UpsertService {
  async upsert(eventId: number, dataset: ParsedDataset, options?: UpsertOptions): Promise<UpsertResult> {
    const processRegistrations = options?.processRegistrations ?? true;
    const inserted: Record<string, number> = {};
    const updated: Record<string, number> = {};
    const warnings: string[] = [...dataset.warnings];

    const clubsByNormalized = new Map<string, CachedClub>();
    const categoriesByNormalized = new Map<string, CachedCategory>();
    const categoriesByCbtmId = new Map<string, CachedCategory>();
    const athletesById = new Map<number, CachedAthlete>();
    const aliasToAthleteIds = new Map<string, Set<number>>();
    const conflictsByKey = new Map<string, CachedConflict>();
    const federationWarningKeys = new Set<string>();
    const registrationCategoriesByAthlete = new Map<number, Set<number>>();
    const observedRegistrationPairs = new Map<
      string,
      {
        athleteId: number;
        categoryId: number;
        categoryName: string;
        registrationStatus: RegistrationStatus | null;
      }
    >();

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: {
        nivel: true,
        concluido: true,
        inicioInscricoes: true,
        fimInscricoes: true,
        inicioRealizacao: true,
        fimRealizacao: true,
        dataInicio: true,
        dataFim: true,
      },
    });
    const eventLevel: EventLevel | null = event?.nivel ?? null;
    const eventSituation: EventSituation = computeEventSituation({
      inicioInscricoes: event?.inicioInscricoes ?? null,
      fimInscricoes: event?.fimInscricoes ?? null,
      inicioRealizacao: event?.inicioRealizacao ?? null,
      fimRealizacao: event?.fimRealizacao ?? null,
      dataInicio: event?.dataInicio ?? null,
      dataFim: event?.dataFim ?? null,
    });

    await this.preloadState({
      eventId,
      clubsByNormalized,
      categoriesByNormalized,
      categoriesByCbtmId,
      athletesById,
      aliasToAthleteIds,
      conflictsByKey,
    });

    for (const parsedCategory of dataset.categories) {
      await this.ensureCategory(
        eventId,
        parsedCategory.categoryName,
        parsedCategory.categoryNormalizedName,
        parsedCategory.categoryId ?? null,
        categoriesByNormalized,
        categoriesByCbtmId,
        inserted,
        updated,
      );
    }

    if (processRegistrations) {
      for (const registration of dataset.registrations) {
        const athleteNameDisplay = compactWhitespace(registration.athleteName);
        const athleteNameNormalized =
          normalizeText(registration.athleteNormalizedName) || normalizeText(athleteNameDisplay);
        if (!athleteNameDisplay || !athleteNameNormalized) {
          warnings.push(
            `Inscricao ignorada por atleta invalido na categoria '${registration.categoryName}'.`,
          );
          continue;
        }

        const clubNameDisplay = compactWhitespace(registration.clubName) || "SEM CLUBE";
        const clubNameNormalized =
          normalizeText(registration.clubNormalizedName) || normalizeText(clubNameDisplay) || "sem clube";
        const categoryNameDisplay = compactWhitespace(registration.categoryName);
        const categoryNameNormalized =
          normalizeText(registration.categoryNormalizedName) || normalizeText(categoryNameDisplay);
        if (!categoryNameDisplay || !categoryNameNormalized) {
          warnings.push(
            `Inscricao ignorada por categoria invalida para atleta '${athleteNameDisplay}'.`,
          );
          continue;
        }

        const club = await this.ensureClub(
          clubNameDisplay,
          clubNameNormalized,
          clubsByNormalized,
          inserted,
          updated,
        );

        const category = await this.ensureCategory(
          eventId,
          categoryNameDisplay,
          categoryNameNormalized,
          registration.categoryId ?? null,
          categoriesByNormalized,
          categoriesByCbtmId,
          inserted,
          updated,
        );

        const athlete = await this.ensureRegisteredAthlete({
          eventId,
          eventLevel,
          club,
          nameDisplay: athleteNameDisplay,
          nameNormalized: athleteNameNormalized,
          rankingPoints: registration.rankingPoints,
          ratingPoints: registration.ratingPoints,
          inserted,
          updated,
          warnings,
          federationWarningKeys,
          athletesById,
        });

        await this.ensureAthleteAlias({
          athleteId: athlete.id,
          aliasDisplay: athleteNameDisplay,
          aliasNormalized: athleteNameNormalized,
          source: "INSCRICOES",
          inserted,
          updated,
          athletesById,
          aliasToAthleteIds,
        });

        const registrationAliases = buildRegistrationAliases({
          nameDisplay: athleteNameDisplay,
          nameNormalized: athleteNameNormalized,
        });
        for (const alias of registrationAliases) {
          await this.ensureAthleteAlias({
            athleteId: athlete.id,
            aliasDisplay: alias.aliasDisplay,
            aliasNormalized: alias.aliasNormalized,
            source: "INSCRICOES",
            inserted,
            updated,
            athletesById,
            aliasToAthleteIds,
          });
        }

        const registrationStatus = toRegistrationStatus(registration.status);
        await prisma.athleteCategory.upsert({
          where: {
            athleteId_categoryId: {
              athleteId: athlete.id,
              categoryId: category.id,
            },
          },
          create: {
            athleteId: athlete.id,
            categoryId: category.id,
            registrationStatus,
            rankingPoints: registration.rankingPoints,
            ratingPoints: registration.ratingPoints,
          },
          update: {
            registrationStatus,
            rankingPoints: registration.rankingPoints,
            ratingPoints: registration.ratingPoints,
          },
        });

        const observed = registrationCategoriesByAthlete.get(athlete.id) ?? new Set<number>();
        observed.add(category.id);
        registrationCategoriesByAthlete.set(athlete.id, observed);
        observedRegistrationPairs.set(`${athlete.id}|${category.id}`, {
          athleteId: athlete.id,
          categoryId: category.id,
          categoryName: category.name,
          registrationStatus,
        });
      }
    }

    const observedRegistrationStatsByCategory = new Map<number, ObservedRegistrationCategoryStats>();
    const athleteIdsByCategoryId = new Map<number, Set<number>>();
    for (const pair of observedRegistrationPairs.values()) {
      const bucket = observedRegistrationStatsByCategory.get(pair.categoryId) ?? {
        categoryName: pair.categoryName,
        total: 0,
        inscrito: 0,
        preInscrito: 0,
        outro: 0,
        unknown: 0,
      };
      bucket.total += 1;
      if (pair.registrationStatus === "INSCRITO") {
        bucket.inscrito += 1;
      } else if (pair.registrationStatus === "PRE_INSCRITO") {
        bucket.preInscrito += 1;
      } else if (pair.registrationStatus === "OUTRO") {
        bucket.outro += 1;
      } else {
        bucket.unknown += 1;
      }
      observedRegistrationStatsByCategory.set(pair.categoryId, bucket);
    }

    if (
      processRegistrations &&
      shouldSyncRegistrationSnapshot({
        eventConcluded: Boolean(event?.concluido),
        eventSituation,
        registrationCount: dataset.registrations.length,
      })
    ) {
      await this.syncMutableRegistrationCategories({
        eventId,
        registrationCategoriesByAthlete,
        updated,
        warnings,
      });

      await this.reportRegistrationSnapshotStats({
        eventId,
        observedRegistrationStatsByCategory,
        updated,
        warnings,
      });

      await this.sanitizeRegistrationOrphanAthletes({
        eventId,
        updated,
        warnings,
      });
    }

    const persistedAthleteCategories = await prisma.athleteCategory.findMany({
      where: {
        category: {
          eventId,
        },
      },
      select: {
        athleteId: true,
        categoryId: true,
      },
    });
    for (const row of persistedAthleteCategories) {
      const bucket = athleteIdsByCategoryId.get(row.categoryId) ?? new Set<number>();
      bucket.add(row.athleteId);
      athleteIdsByCategoryId.set(row.categoryId, bucket);
    }

    const mergedMatches = mergeMatchesAcrossSources(eventId, dataset.matches);
    warnings.push(...mergedMatches.warnings);
    const dedupedMatches = deduplicateParsedMatches(mergedMatches.matches);
    if (dedupedMatches.removed > 0) {
      warnings.push(
        `Deduplicação de ingestão removeu ${dedupedMatches.removed} jogo(s) repetido(s) antes de persistir.`,
      );
      updated.matches_deduplicated_input =
        (updated.matches_deduplicated_input ?? 0) + dedupedMatches.removed;
    }

    if (dedupedMatches.droppedMatchKeys.length > 0) {
      const staleMatches = await prisma.match.findMany({
        where: {
          eventId,
          matchKey: {
            in: dedupedMatches.droppedMatchKeys,
          },
        },
        select: { id: true },
      });

      const staleMatchIds = staleMatches.map((item) => item.id);
      if (staleMatchIds.length > 0) {
        await prisma.matchParticipant.deleteMany({
          where: {
            matchId: {
              in: staleMatchIds,
            },
          },
        });

        const deletedMatches = await prisma.match.deleteMany({
          where: {
            id: {
              in: staleMatchIds,
            },
          },
        });

        if (deletedMatches.count > 0) {
          updated.matches_removed_by_dedup =
            (updated.matches_removed_by_dedup ?? 0) + deletedMatches.count;
          warnings.push(
            `Deduplicação removeu ${deletedMatches.count} jogo(s) duplicado(s) já persistido(s) no banco.`,
          );
        }
      }
    }

    for (const parsedMatch of dedupedMatches.matches) {
      const category = await this.ensureCategory(
        eventId,
        parsedMatch.categoryName,
        parsedMatch.categoryNormalizedName,
        parsedMatch.categoryId ?? null,
        categoriesByNormalized,
        categoriesByCbtmId,
        inserted,
        updated,
      );

      const athleteA = await this.resolveMatchAthlete({
        eventId,
        categoryId: category.id,
        side: "A",
        matchKey: parsedMatch.matchKey,
        categoryName: parsedMatch.categoryName,
        shortName: parsedMatch.athleteAName,
        participantRefType: parsedMatch.athleteARefType ?? "REAL",
        rankingPoints: toOptionalInt(parsedMatch.athleteARankingPoints),
        ratingPoints: toOptionalInt(parsedMatch.athleteARatingPoints),
        clubNormalizedName: normalizeText(parsedMatch.athleteAClubNormalizedName ?? "") || null,
        inserted,
        updated,
        warnings,
        athletesById,
        aliasToAthleteIds,
        conflictsByKey,
        categoryAthleteIds: athleteIdsByCategoryId.get(category.id) ?? null,
      });

      const athleteB = await this.resolveMatchAthlete({
        eventId,
        categoryId: category.id,
        side: "B",
        matchKey: parsedMatch.matchKey,
        categoryName: parsedMatch.categoryName,
        shortName: parsedMatch.athleteBName,
        participantRefType: parsedMatch.athleteBRefType ?? "REAL",
        rankingPoints: toOptionalInt(parsedMatch.athleteBRankingPoints),
        ratingPoints: toOptionalInt(parsedMatch.athleteBRatingPoints),
        clubNormalizedName: normalizeText(parsedMatch.athleteBClubNormalizedName ?? "") || null,
        inserted,
        updated,
        warnings,
        athletesById,
        aliasToAthleteIds,
        conflictsByKey,
        categoryAthleteIds: athleteIdsByCategoryId.get(category.id) ?? null,
      });

      const existingMatch = await prisma.match.findUnique({
        where: { matchKey: parsedMatch.matchKey },
        select: {
          id: true,
          scoreRaw: true,
          setsJson: true,
          p1Sets: true,
          p2Sets: true,
          winnerIndex: true,
          cbtmMatchId: true,
          scoreFinal: true,
          scoreSets: true,
          sourceFlags: true,
        },
      });

      const normalizedSets = sanitizeParsedMatchSets(parsedMatch.sets);
      const parsedScoreRaw = parseScoreRaw(parsedMatch.scoreRaw);
      const scoreSetsFromIncoming = normalizedSets.length
        ? normalizedSets.map((set, index) => ({
            set: index + 1,
            a: set.p1,
            b: set.p2,
          }))
        : (parsedScoreRaw?.sets ?? []);

      const existingScoreSets = parseStoredScoreSets(existingMatch?.scoreSets ?? null);
      const existingLegacySets = parseStoredSetsJson(existingMatch?.setsJson ?? null).map((set, index) => ({
        set: index + 1,
        a: set.p1,
        b: set.p2,
      }));

      let scoreSets = scoreSetsFromIncoming;
      if (existingScoreSets.length > scoreSets.length) {
        scoreSets = existingScoreSets;
      } else if (scoreSets.length === 0 && existingLegacySets.length > 0) {
        scoreSets = existingLegacySets;
      }

      const effectiveSets = scoreSets.map((set) => ({
        p1: set.a,
        p2: set.b,
      }));

      const incomingSetsResult =
        parsedMatch.setsResult ??
        (parsedScoreRaw?.final
          ? {
              p1Sets: parsedScoreRaw.final.setsA,
              p2Sets: parsedScoreRaw.final.setsB,
            }
          : null) ??
        parseSetsResultFromScoreRaw(parsedMatch.scoreRaw);

      const existingSetsResultFromScoreFinal = parseStoredScoreFinal(existingMatch?.scoreFinal ?? null);
      const existingSetsResultFromColumns =
        Number.isFinite(Number(existingMatch?.p1Sets)) && Number.isFinite(Number(existingMatch?.p2Sets))
          ? {
              p1Sets: Number(existingMatch?.p1Sets),
              p2Sets: Number(existingMatch?.p2Sets),
            }
          : null;
      const existingSetsResult = existingSetsResultFromScoreFinal ?? existingSetsResultFromColumns;

      const setsResult = incomingSetsResult ?? existingSetsResult ?? inferSetsResultFromSets(effectiveSets);
      let winnerIndex = resolveWinnerIndex({
        ...parsedMatch,
        sets: effectiveSets,
        setsResult,
      });
      if (winnerIndex === null && (existingMatch?.winnerIndex === 0 || existingMatch?.winnerIndex === 1)) {
        winnerIndex = existingMatch.winnerIndex;
      }

      const scorePlayers: Prisma.InputJsonValue = [
        {
          athleteId: athleteA?.id ?? null,
          name: athleteA?.nameDisplay ?? compactWhitespace(parsedMatch.athleteAName),
        },
        {
          athleteId: athleteB?.id ?? null,
          name: athleteB?.nameDisplay ?? compactWhitespace(parsedMatch.athleteBName),
        },
      ];
      const setsJsonValue: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput =
        effectiveSets.length > 0
          ? (effectiveSets as unknown as Prisma.InputJsonValue)
          : Prisma.DbNull;
      const scoreFinalValue: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput =
        setsResult
          ? ({
              setsA: setsResult.p1Sets,
              setsB: setsResult.p2Sets,
            } as Prisma.InputJsonValue)
          : Prisma.DbNull;
      const scoreSetsValue: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput =
        scoreSets.length > 0
          ? (scoreSets as unknown as Prisma.InputJsonValue)
          : Prisma.DbNull;
      const storedSourceFlags = parseStoredSourceFlags(existingMatch?.sourceFlags ?? null);
      const mergedSourceFlags = {
        resultados: Boolean(parsedMatch.sourceFlags?.resultados) || Boolean(storedSourceFlags?.resultados),
        eliminatoria: Boolean(parsedMatch.sourceFlags?.eliminatoria) || Boolean(storedSourceFlags?.eliminatoria),
      };
      const sourceFlagsValue: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput =
        mergedSourceFlags.resultados || mergedSourceFlags.eliminatoria
          ? ({
              resultados: mergedSourceFlags.resultados,
              eliminatoria: mergedSourceFlags.eliminatoria,
            } as Prisma.InputJsonValue)
          : Prisma.DbNull;
      const cbtmMatchIdFromMetadata = compactWhitespace(
        String(parsedMatch.metadata?.cbtmMatchId ?? parsedMatch.metadata?.matchId ?? parsedMatch.metadata?.gameId ?? parsedMatch.metadata?.jogo ?? ""),
      );
      const cbtmMatchId =
        compactWhitespace(parsedMatch.cbtmMatchId ?? "") ||
        (cbtmMatchIdFromMetadata ? cbtmMatchIdFromMetadata : null) ||
        compactWhitespace(existingMatch?.cbtmMatchId ?? "") ||
        null;
      const nextScoreRaw =
        existingMatch && getScoreRawQuality(existingMatch.scoreRaw) > getScoreRawQuality(parsedMatch.scoreRaw)
          ? existingMatch.scoreRaw
          : parsedMatch.scoreRaw;

      if (parsedMatch.phase === "RESULTADOS" && setsResult && scoreSets.length === 0) {
        warnings.push(
          `Resultado sem placar por set persistivel no match ${parsedMatch.matchKey} (${parsedMatch.categoryName}).`,
        );
      }

      const persistedMatch = existingMatch
        ? await prisma.match.update({
            where: { id: existingMatch.id },
            data: {
              eventId,
              categoryId: category.id,
              phase: parsedMatch.phase as MatchPhase,
              round: parsedMatch.round,
              tableNumber: parsedMatch.tableNumber,
              matchDatetime: parsedMatch.matchDatetime ? new Date(parsedMatch.matchDatetime) : null,
              scoreRaw: nextScoreRaw,
              setsJson: setsJsonValue,
              p1Sets: setsResult?.p1Sets ?? null,
              p2Sets: setsResult?.p2Sets ?? null,
              winnerIndex,
              scorePlayers,
              cbtmMatchId,
              scoreFinal: scoreFinalValue,
              scoreSets: scoreSetsValue,
              sourceFlags: sourceFlagsValue,
              sourceUrl: parsedMatch.sourceUrl ?? null,
              fetchedAt: new Date(),
            },
            select: { id: true },
          })
        : await prisma.match.create({
            data: {
              eventId,
              categoryId: category.id,
              phase: parsedMatch.phase as MatchPhase,
              round: parsedMatch.round,
              tableNumber: parsedMatch.tableNumber,
              matchDatetime: parsedMatch.matchDatetime ? new Date(parsedMatch.matchDatetime) : null,
              scoreRaw: nextScoreRaw,
              setsJson: setsJsonValue,
              p1Sets: setsResult?.p1Sets ?? null,
              p2Sets: setsResult?.p2Sets ?? null,
              winnerIndex,
              scorePlayers,
              cbtmMatchId,
              scoreFinal: scoreFinalValue,
              scoreSets: scoreSetsValue,
              sourceFlags: sourceFlagsValue,
              sourceUrl: parsedMatch.sourceUrl ?? null,
              fetchedAt: new Date(),
              matchKey: parsedMatch.matchKey,
            },
            select: { id: true },
          });

      if (existingMatch) {
        inc(updated, "matches");
      } else {
        inc(inserted, "matches");
      }

      if (athleteA) {
        await prisma.athleteCategory.upsert({
          where: {
            athleteId_categoryId: {
              athleteId: athleteA.id,
              categoryId: category.id,
            },
          },
          update: {},
          create: {
            athleteId: athleteA.id,
            categoryId: category.id,
          },
        });
        const categoryAthleteBucketA = athleteIdsByCategoryId.get(category.id) ?? new Set<number>();
        categoryAthleteBucketA.add(athleteA.id);
        athleteIdsByCategoryId.set(category.id, categoryAthleteBucketA);
      }

      if (athleteB) {
        await prisma.athleteCategory.upsert({
          where: {
            athleteId_categoryId: {
              athleteId: athleteB.id,
              categoryId: category.id,
            },
          },
          update: {},
          create: {
            athleteId: athleteB.id,
            categoryId: category.id,
          },
        });
        const categoryAthleteBucketB = athleteIdsByCategoryId.get(category.id) ?? new Set<number>();
        categoryAthleteBucketB.add(athleteB.id);
        athleteIdsByCategoryId.set(category.id, categoryAthleteBucketB);
      }

      const participantIds = [...new Set([athleteA?.id, athleteB?.id].filter((value): value is number => value !== undefined))];
      if (athleteA && athleteB && athleteA.id === athleteB.id) {
        warnings.push(
          `Jogo ${parsedMatch.matchKey} ficou com atleta duplicado (${athleteA.nameDisplay}).`,
        );
      }

      if (participantIds.length > 0) {
        await prisma.matchParticipant.deleteMany({
          where: {
            matchId: persistedMatch.id,
            athleteId: {
              notIn: participantIds,
            },
          },
        });
      } else {
        await prisma.matchParticipant.deleteMany({
          where: {
            matchId: persistedMatch.id,
          },
        });
      }

      for (const athleteId of participantIds) {
        await prisma.matchParticipant.upsert({
          where: {
            matchId_athleteId: {
              matchId: persistedMatch.id,
              athleteId,
            },
          },
          update: {},
          create: {
            matchId: persistedMatch.id,
            athleteId,
          },
        });
      }
    }

    await this.cleanupNonRealAthleteRecords({
      eventId,
      athletesById,
      aliasToAthleteIds,
      updated,
    });

    return {
      inserted,
      updated,
      warnings,
      extractionStats: dataset.extractionStats,
    };
  }

  private async preloadState(input: {
    eventId: number;
    clubsByNormalized: Map<string, CachedClub>;
    categoriesByNormalized: Map<string, CachedCategory>;
    categoriesByCbtmId: Map<string, CachedCategory>;
    athletesById: Map<number, CachedAthlete>;
    aliasToAthleteIds: Map<string, Set<number>>;
    conflictsByKey: Map<string, CachedConflict>;
  }): Promise<void> {
    const [categories, athletes, conflicts] = await Promise.all([
      prisma.category.findMany({
        where: { eventId: input.eventId },
      }),
      prisma.athlete.findMany({
        where: { eventId: input.eventId },
        include: {
          club: true,
          aliases: true,
        },
      }),
      prisma.athleteMatchConflict.findMany({
        where: { eventId: input.eventId },
        select: {
          id: true,
          context: true,
          shortNameNormalized: true,
          resolvedAthleteId: true,
          candidateAthletes: true,
        },
      }),
    ]);

    for (const category of categories) {
      input.categoriesByNormalized.set(category.normalizedName, {
        id: category.id,
        name: category.name,
        normalizedName: category.normalizedName,
        cbtmCategoryId: category.cbtmCategoryId,
      });
      if (category.cbtmCategoryId) {
        input.categoriesByCbtmId.set(category.cbtmCategoryId, {
          id: category.id,
          name: category.name,
          normalizedName: category.normalizedName,
          cbtmCategoryId: category.cbtmCategoryId,
        });
      }
    }

    for (const athlete of athletes) {
      const cacheAthlete: CachedAthlete = {
        id: athlete.id,
        eventId: athlete.eventId,
        clubId: athlete.clubId,
        clubNormalizedName: athlete.club?.normalizedName ?? null,
        stateCode: athlete.stateCode,
        stateName: athlete.stateName,
        region: athlete.region,
        nameDisplay: athlete.nameDisplay,
        nameNormalized: athlete.nameNormalized,
        rankingPoints: athlete.rankingPoints,
        ratingPoints: athlete.ratingPoints,
        createdFromWarning: athlete.createdFromWarning,
        aliases: new Set<string>(),
      };

      cacheAthlete.aliases.add(athlete.nameNormalized);
      this.indexAlias(input.aliasToAthleteIds, athlete.nameNormalized, athlete.id);

      for (const alias of athlete.aliases) {
        cacheAthlete.aliases.add(alias.aliasNormalized);
        this.indexAlias(input.aliasToAthleteIds, alias.aliasNormalized, athlete.id);
      }

      input.athletesById.set(athlete.id, cacheAthlete);

      if (athlete.club?.normalizedName) {
        input.clubsByNormalized.set(athlete.club.normalizedName, {
          id: athlete.club.id,
          name: athlete.club.name,
          normalizedName: athlete.club.normalizedName,
        });
      }
    }

    for (const conflict of conflicts) {
      input.conflictsByKey.set(
        conflictCacheKey(conflict.context, conflict.shortNameNormalized),
        conflict,
      );
    }
  }

  private async ensureClub(
    name: string,
    normalizedName: string,
    clubsByNormalized: Map<string, CachedClub>,
    inserted: Record<string, number>,
    updated: Record<string, number>,
  ): Promise<CachedClub> {
    const cached = clubsByNormalized.get(normalizedName);
    if (cached) {
      if (cached.name !== name) {
        await prisma.club.update({
          where: { id: cached.id },
          data: { name },
        });
        cached.name = name;
        inc(updated, "clubs");
      }
      return cached;
    }

    const found = await prisma.club.findUnique({
      where: { normalizedName },
    });

    if (found) {
      const record =
        found.name === name
          ? found
          : await prisma.club.update({
              where: { id: found.id },
              data: { name },
            });

      if (found.name === name) {
        inc(updated, "clubs_cache_hits");
      } else {
        inc(updated, "clubs");
      }

      const cachedClub: CachedClub = {
        id: record.id,
        name: record.name,
        normalizedName: record.normalizedName,
      };
      clubsByNormalized.set(normalizedName, cachedClub);
      return cachedClub;
    }

    const created = await prisma.club.create({
      data: {
        name,
        normalizedName,
      },
    });

    inc(inserted, "clubs");

    const cachedClub: CachedClub = {
      id: created.id,
      name: created.name,
      normalizedName: created.normalizedName,
    };

    clubsByNormalized.set(normalizedName, cachedClub);
    return cachedClub;
  }

  private async syncMutableRegistrationCategories(input: {
    eventId: number;
    registrationCategoriesByAthlete: Map<number, Set<number>>;
    updated: Record<string, number>;
    warnings: string[];
  }): Promise<void> {
    if (input.registrationCategoriesByAthlete.size === 0) {
      return;
    }

    const observedPairKeys = new Set<string>();
    for (const [athleteId, categoryIds] of input.registrationCategoriesByAthlete.entries()) {
      for (const categoryId of categoryIds) {
        observedPairKeys.add(`${athleteId}|${categoryId}`);
      }
    }

    const existing = await prisma.athleteCategory.findMany({
      where: {
        category: {
          eventId: input.eventId,
        },
        athlete: {
          eventId: input.eventId,
          createdFromWarning: false,
        },
      },
      select: {
        athleteId: true,
        categoryId: true,
        registrationStatus: true,
        athlete: {
          select: { id: true, nameDisplay: true },
        },
        category: {
          select: { id: true, name: true, cbtmCategoryId: true },
        },
      },
    });

    if (existing.length === 0) {
      return;
    }

    const precheck = shouldAllowDestructiveRegistrationSync({
      existingPairCount: existing.length,
      observedPairCount: observedPairKeys.size,
    });
    if (!precheck.allow) {
      input.warnings.push(
        `Sincronizacao de inscricoes ignorada no evento ${input.eventId} por snapshot parcial (coverage=${Math.round(
          precheck.coverageRatio * 100,
        )}%, observados=${observedPairKeys.size}, atuais=${existing.length}, motivo=${precheck.reason}).`,
      );
      input.updated.registration_sync_skipped_guard =
        (input.updated.registration_sync_skipped_guard ?? 0) + 1;
      return;
    }

    const protectedCategoryIds = new Set<number>(
      existing
        .filter((row) => row.category.cbtmCategoryId && IGNORED_CATEGORY_IDS.has(row.category.cbtmCategoryId))
        .map((row) => row.categoryId),
    );

    const removablePairs = computeEventRegistrationPairRemovals({
      currentPairs: existing.map((row) => ({
        athleteId: row.athleteId,
        categoryId: row.categoryId,
        registrationStatus: row.registrationStatus,
      })),
      observedPairKeys,
      protectedCategoryIds,
    });

    if (removablePairs.length === 0) {
      return;
    }

    const removalGuard = shouldAllowDestructiveRegistrationSync({
      existingPairCount: existing.length,
      observedPairCount: observedPairKeys.size,
      projectedRemovalCount: removablePairs.length,
    });
    if (!removalGuard.allow) {
      input.warnings.push(
        `Sincronizacao de inscricoes bloqueou remocao massiva no evento ${input.eventId} (remocoes=${removablePairs.length}, atuais=${existing.length}, coverage=${Math.round(
          removalGuard.coverageRatio * 100,
        )}%, motivo=${removalGuard.reason}).`,
      );
      input.updated.registration_sync_skipped_guard =
        (input.updated.registration_sync_skipped_guard ?? 0) + 1;
      return;
    }

    const removableByAthlete = new Map<number, Set<number>>();
    for (const pair of removablePairs) {
      const bucket = removableByAthlete.get(pair.athleteId) ?? new Set<number>();
      bucket.add(pair.categoryId);
      removableByAthlete.set(pair.athleteId, bucket);
    }

    if (removableByAthlete.size === 0) {
      return;
    }

    const existingByAthlete = new Map<number, typeof existing>();
    for (const row of existing) {
      const bucket = existingByAthlete.get(row.athleteId) ?? [];
      bucket.push(row);
      existingByAthlete.set(row.athleteId, bucket);
    }

    let removedCount = 0;
    for (const [athleteId, categoryIdsSet] of removableByAthlete.entries()) {
      const categoryIds = [...categoryIdsSet];
      if (categoryIds.length === 0) {
        continue;
      }

      const removed = await prisma.athleteCategory.deleteMany({
        where: {
          athleteId,
          categoryId: { in: categoryIds },
        },
      });
      removedCount += removed.count;

      const currentRows = existingByAthlete.get(athleteId) ?? [];
      const removedNames = currentRows
        .filter((row) => categoryIds.includes(row.categoryId))
        .map((row) => row.category.name)
        .join(", ");
      const athleteName = currentRows[0]?.athlete.nameDisplay ?? `#${athleteId}`;
      input.warnings.push(
        `Snapshot de inscricoes removeu categorias antigas de '${athleteName}' no evento ${input.eventId}: ${removedNames}.`,
      );
    }

    if (removedCount > 0) {
      input.updated.athlete_categories_removed_from_snapshot =
        (input.updated.athlete_categories_removed_from_snapshot ?? 0) + removedCount;
      input.warnings.push(
        `Sincronizacao de inscricoes removeu ${removedCount} vinculo(s) obsoleto(s) de atleta-categoria no evento ${input.eventId}.`,
      );
    }
  }

  private async reportRegistrationSnapshotStats(input: {
    eventId: number;
    observedRegistrationStatsByCategory: Map<number, ObservedRegistrationCategoryStats>;
    updated: Record<string, number>;
    warnings: string[];
  }): Promise<void> {
    const observedCategoryIds = [...input.observedRegistrationStatsByCategory.keys()];
    if (observedCategoryIds.length === 0) {
      return;
    }

    const persistedRows = await prisma.athleteCategory.findMany({
      where: {
        categoryId: { in: observedCategoryIds },
        category: { eventId: input.eventId },
        athlete: {
          eventId: input.eventId,
          createdFromWarning: false,
        },
      },
      select: {
        athleteId: true,
        categoryId: true,
        registrationStatus: true,
      },
    });

    const persistedByCategory = new Map<
      number,
      { total: number; inscrito: number; preInscrito: number; outro: number; unknown: number }
    >();
    for (const row of persistedRows) {
      const bucket = persistedByCategory.get(row.categoryId) ?? {
        total: 0,
        inscrito: 0,
        preInscrito: 0,
        outro: 0,
        unknown: 0,
      };
      bucket.total += 1;
      if (row.registrationStatus === "INSCRITO") {
        bucket.inscrito += 1;
      } else if (row.registrationStatus === "PRE_INSCRITO") {
        bucket.preInscrito += 1;
      } else if (row.registrationStatus === "OUTRO") {
        bucket.outro += 1;
      } else {
        bucket.unknown += 1;
      }
      persistedByCategory.set(row.categoryId, bucket);
    }

    let categoriesWithMismatch = 0;
    for (const [categoryId, observed] of input.observedRegistrationStatsByCategory.entries()) {
      const persisted = persistedByCategory.get(categoryId) ?? {
        total: 0,
        inscrito: 0,
        preInscrito: 0,
        outro: 0,
        unknown: 0,
      };
      const matchesSnapshot =
        observed.total === persisted.total &&
        observed.inscrito === persisted.inscrito &&
        observed.preInscrito === persisted.preInscrito &&
        observed.outro === persisted.outro;

      if (!matchesSnapshot) {
        categoriesWithMismatch += 1;
        input.warnings.push(
          `[registration_sync][categoria=${observed.categoryName}#${categoryId}] fonte(total=${observed.total}, inscrito=${observed.inscrito}, pre=${observed.preInscrito}, outro=${observed.outro}) banco(total=${persisted.total}, inscrito=${persisted.inscrito}, pre=${persisted.preInscrito}, outro=${persisted.outro}).`,
        );
      }
    }

    input.updated.registration_categories_snapshot_checked =
      (input.updated.registration_categories_snapshot_checked ?? 0) + observedCategoryIds.length;
    if (categoriesWithMismatch > 0) {
      input.updated.registration_categories_snapshot_mismatch =
        (input.updated.registration_categories_snapshot_mismatch ?? 0) + categoriesWithMismatch;
    }
  }

  private async sanitizeRegistrationOrphanAthletes(input: {
    eventId: number;
    updated: Record<string, number>;
    warnings: string[];
  }): Promise<void> {
    const orphanAthletes = await prisma.athlete.findMany({
      where: {
        eventId: input.eventId,
        createdFromWarning: false,
        categories: {
          none: {},
        },
      },
      select: {
        id: true,
        nameDisplay: true,
      },
    });

    if (orphanAthletes.length === 0) {
      return;
    }

    const orphanAthleteIds = orphanAthletes.map((athlete) => athlete.id);
    const athletesWithMatches = await prisma.matchParticipant.findMany({
      where: {
        athleteId: { in: orphanAthleteIds },
        match: {
          eventId: input.eventId,
        },
      },
      select: {
        athleteId: true,
      },
      distinct: ["athleteId"],
    });

    const protectedByMatches = new Set<number>(athletesWithMatches.map((row) => row.athleteId));
    const removableAthletes = orphanAthletes.filter((athlete) => !protectedByMatches.has(athlete.id));
    const removableAthleteIds = removableAthletes.map((athlete) => athlete.id);

    if (protectedByMatches.size > 0) {
      input.warnings.push(
        `Sanitizacao de inscricoes preservou ${protectedByMatches.size} atleta(s) sem vinculo atleta-categoria por ja possuirem partidas no evento ${input.eventId}.`,
      );
    }

    if (removableAthleteIds.length === 0) {
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.athleteAlias.deleteMany({
        where: {
          athleteId: { in: removableAthleteIds },
        },
      });

      await tx.athleteCategory.deleteMany({
        where: {
          athleteId: { in: removableAthleteIds },
        },
      });

      await tx.athlete.deleteMany({
        where: {
          id: { in: removableAthleteIds },
        },
      });
    });

    input.updated.athletes_removed_without_category_link =
      (input.updated.athletes_removed_without_category_link ?? 0) + removableAthleteIds.length;
    input.warnings.push(
      `Sanitizacao de inscricoes removeu ${removableAthleteIds.length} atleta(s) sem vinculo atleta-categoria no evento ${input.eventId}.`,
    );
  }

  private async ensureCategory(
    eventId: number,
    name: string,
    normalizedName: string,
    cbtmCategoryId: string | null,
    categoriesByNormalized: Map<string, CachedCategory>,
    categoriesByCbtmId: Map<string, CachedCategory>,
    inserted: Record<string, number>,
    updated: Record<string, number>,
  ): Promise<CachedCategory> {
    const toCachedCategory = (category: {
      id: number;
      name: string;
      normalizedName: string;
      cbtmCategoryId: string | null;
    }): CachedCategory => ({
      id: category.id,
      name: category.name,
      normalizedName: category.normalizedName,
      cbtmCategoryId: category.cbtmCategoryId,
    });

    const syncCategoryCache = (
      category: CachedCategory,
      previous?: { normalizedName: string; cbtmCategoryId: string | null },
    ): void => {
      if (previous) {
        if (previous.normalizedName && previous.normalizedName !== category.normalizedName) {
          const previousOwner = categoriesByNormalized.get(previous.normalizedName);
          if (previousOwner?.id === category.id) {
            categoriesByNormalized.delete(previous.normalizedName);
          }
        }

        if (previous.cbtmCategoryId && previous.cbtmCategoryId !== category.cbtmCategoryId) {
          const previousById = categoriesByCbtmId.get(previous.cbtmCategoryId);
          if (previousById?.id === category.id) {
            categoriesByCbtmId.delete(previous.cbtmCategoryId);
          }
        }
      }

      categoriesByNormalized.set(category.normalizedName, category);
      if (category.cbtmCategoryId) {
        categoriesByCbtmId.set(category.cbtmCategoryId, category);
      }
    };

    const isNormalizedUniqueViolation = (error: unknown): boolean => {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
        return false;
      }
      if (error.code !== "P2002") {
        return false;
      }

      const target = (error.meta as { target?: unknown } | undefined)?.target;
      const targetText = Array.isArray(target)
        ? target.join(",")
        : String(target ?? "");

      return targetText.includes("event_id") && targetText.includes("normalized_name");
    };

    const findCategoryByNormalized = async (desiredNormalizedName: string): Promise<CachedCategory | null> => {
      const cachedOwner = categoriesByNormalized.get(desiredNormalizedName);
      if (cachedOwner) {
        return cachedOwner;
      }

      const found = await prisma.category.findUnique({
        where: {
          eventId_normalizedName: {
            eventId,
            normalizedName: desiredNormalizedName,
          },
        },
      });
      if (!found) {
        return null;
      }

      const cachedFound = toCachedCategory(found);
      syncCategoryCache(cachedFound);
      return cachedFound;
    };

    const updateCategoryRecord = async (
      category: CachedCategory,
      data: { name?: string; normalizedName?: string; cbtmCategoryId?: string | null },
    ): Promise<CachedCategory> => {
      const nextName = data.name ?? category.name;
      const nextNormalizedName = data.normalizedName ?? category.normalizedName;
      const nextCbtmCategoryId =
        data.cbtmCategoryId !== undefined ? data.cbtmCategoryId : category.cbtmCategoryId;

      const changed =
        category.name !== nextName ||
        category.normalizedName !== nextNormalizedName ||
        category.cbtmCategoryId !== nextCbtmCategoryId;

      if (!changed) {
        return category;
      }

      const previous = {
        normalizedName: category.normalizedName,
        cbtmCategoryId: category.cbtmCategoryId,
      };

      try {
        await prisma.category.update({
          where: { id: category.id },
          data: {
            name: nextName,
            normalizedName: nextNormalizedName,
            cbtmCategoryId: nextCbtmCategoryId,
          },
        });
      } catch (error) {
        if (nextNormalizedName !== category.normalizedName && isNormalizedUniqueViolation(error)) {
          const owner = await findCategoryByNormalized(nextNormalizedName);
          if (owner) {
            inc(updated, "categories_normalized_conflict_resolved");
            return owner;
          }
        }
        throw error;
      }

      category.name = nextName;
      category.normalizedName = nextNormalizedName;
      category.cbtmCategoryId = nextCbtmCategoryId;
      syncCategoryCache(category, previous);
      inc(updated, "categories");
      return category;
    };

    const canUseNormalizedName = (targetCategoryId: number, desiredNormalizedName: string): boolean => {
      const owner = categoriesByNormalized.get(desiredNormalizedName);
      return !owner || owner.id === targetCategoryId;
    };

    if (cbtmCategoryId) {
      const cachedById = categoriesByCbtmId.get(cbtmCategoryId);
      if (cachedById) {
        const patch: { name?: string; normalizedName?: string } = {};
        if (cachedById.name !== name) {
          patch.name = name;
        }
        if (
          cachedById.normalizedName !== normalizedName &&
          canUseNormalizedName(cachedById.id, normalizedName)
        ) {
          patch.normalizedName = normalizedName;
        }

        return updateCategoryRecord(cachedById, patch);
      }
    }

    const cached = categoriesByNormalized.get(normalizedName);
    if (cached) {
      if (cbtmCategoryId && cached.cbtmCategoryId && cached.cbtmCategoryId !== cbtmCategoryId) {
        const categoryById = categoriesByCbtmId.get(cbtmCategoryId);
        if (categoryById && categoryById.id !== cached.id) {
          return categoryById;
        }
      }

      return updateCategoryRecord(cached, {
        name,
        cbtmCategoryId: cbtmCategoryId ?? cached.cbtmCategoryId,
      });
    }

    const foundByCbtmId = cbtmCategoryId
      ? await prisma.category.findUnique({
          where: {
            eventId_cbtmCategoryId: {
              eventId,
              cbtmCategoryId,
            },
          },
        })
      : null;

    if (foundByCbtmId) {
      const cachedCategory: CachedCategory = {
        id: foundByCbtmId.id,
        name: foundByCbtmId.name,
        normalizedName: foundByCbtmId.normalizedName,
        cbtmCategoryId: foundByCbtmId.cbtmCategoryId,
      };
      syncCategoryCache(cachedCategory);

      const patch: { name?: string; normalizedName?: string } = {};
      if (cachedCategory.name !== name) {
        patch.name = name;
      }
      if (
        cachedCategory.normalizedName !== normalizedName &&
        canUseNormalizedName(cachedCategory.id, normalizedName)
      ) {
        patch.normalizedName = normalizedName;
      }
      return updateCategoryRecord(cachedCategory, patch);
    }

    const foundByNormalized = await prisma.category.findUnique({
      where: {
        eventId_normalizedName: {
          eventId,
          normalizedName,
        },
      },
    });

    if (foundByNormalized) {
      if (cbtmCategoryId) {
        const categoryById = categoriesByCbtmId.get(cbtmCategoryId);
        if (categoryById && categoryById.id !== foundByNormalized.id) {
          return categoryById;
        }
      }

      const cachedCategory: CachedCategory = {
        id: foundByNormalized.id,
        name: foundByNormalized.name,
        normalizedName: foundByNormalized.normalizedName,
        cbtmCategoryId: foundByNormalized.cbtmCategoryId,
      };
      syncCategoryCache(cachedCategory);

      return updateCategoryRecord(cachedCategory, {
        name,
        cbtmCategoryId: cbtmCategoryId ?? foundByNormalized.cbtmCategoryId,
      });
    }

    try {
      const created = await prisma.category.create({
        data: {
          eventId,
          name,
          normalizedName,
          cbtmCategoryId,
        },
      });

      inc(inserted, "categories");

      const cachedCategory: CachedCategory = {
        id: created.id,
        name: created.name,
        normalizedName: created.normalizedName,
        cbtmCategoryId: created.cbtmCategoryId,
      };
      syncCategoryCache(cachedCategory);
      return cachedCategory;
    } catch {
      if (cbtmCategoryId) {
        const retryById = await prisma.category.findUnique({
          where: {
            eventId_cbtmCategoryId: {
              eventId,
              cbtmCategoryId,
            },
          },
        });
        if (retryById) {
          const cachedCategory: CachedCategory = {
            id: retryById.id,
            name: retryById.name,
            normalizedName: retryById.normalizedName,
            cbtmCategoryId: retryById.cbtmCategoryId,
          };
          syncCategoryCache(cachedCategory);
          return cachedCategory;
        }
      }

      const retryByNormalized = await prisma.category.findUnique({
        where: {
          eventId_normalizedName: {
            eventId,
            normalizedName,
          },
        },
      });
      if (retryByNormalized) {
        const cachedCategory: CachedCategory = {
          id: retryByNormalized.id,
          name: retryByNormalized.name,
          normalizedName: retryByNormalized.normalizedName,
          cbtmCategoryId: retryByNormalized.cbtmCategoryId,
        };
        syncCategoryCache(cachedCategory);
        return cachedCategory;
      }

      throw new Error(
        `Falha ao criar/atualizar categoria '${name}' (${cbtmCategoryId ?? "sem_id"}) no evento ${eventId}.`,
      );
    }
  }

  private async ensureRegisteredAthlete(input: {
    eventId: number;
    eventLevel: EventLevel | null;
    club: CachedClub;
    nameDisplay: string;
    nameNormalized: string;
    rankingPoints: number | null;
    ratingPoints: number | null;
    inserted: Record<string, number>;
    updated: Record<string, number>;
    warnings: string[];
    federationWarningKeys: Set<string>;
    athletesById: Map<number, CachedAthlete>;
  }): Promise<CachedAthlete> {
    let existing = await prisma.athlete.findUnique({
      where: {
        eventId_nameNormalized_clubId: {
          eventId: input.eventId,
          nameNormalized: input.nameNormalized,
          clubId: input.club.id,
        },
      },
    });

    if (existing) {
      const inferredFederation = inferAthleteFederationFromClub({
        eventLevel: input.eventLevel,
        clubName: input.club.name,
        current: {
          stateCode: existing.stateCode,
          stateName: existing.stateName,
          region: existing.region,
        },
      });
      if (inferredFederation.warning) {
        const warningKey = `${input.eventId}|${input.club.normalizedName}`;
        if (!input.federationWarningKeys.has(warningKey)) {
          input.federationWarningKeys.add(warningKey);
          input.warnings.push(
            `Nao foi possivel inferir UF/regiao pelo clube '${input.club.name}' no evento ${input.eventId}.`,
          );
        }
      }
      if (inferredFederation.source === "club_exception") {
        const warningKey = `${input.eventId}|${input.club.normalizedName}|club_exception`;
        if (!input.federationWarningKeys.has(warningKey)) {
          input.federationWarningKeys.add(warningKey);
          input.warnings.push(
            `UF/regiao inferida por excecao de clube para '${input.club.name}' no evento ${input.eventId}.`,
          );
        }
      }

      const mergedRanking = mergePointValue(existing.rankingPoints, input.rankingPoints);
      const mergedRating = mergePointValue(existing.ratingPoints, input.ratingPoints);
      const resolvedNameDisplay =
        input.nameDisplay.length > existing.nameDisplay.length
          ? input.nameDisplay
          : existing.nameDisplay;
      const updatedRecord = await prisma.athlete.update({
        where: { id: existing.id },
        data: {
          nameDisplay: resolvedNameDisplay,
          rankingPoints: mergedRanking,
          ratingPoints: mergedRating,
          createdFromWarning: false,
          stateCode: inferredFederation.next?.stateCode ?? existing.stateCode,
          stateName: inferredFederation.next?.stateName ?? existing.stateName,
          region: inferredFederation.next?.region ?? existing.region,
        },
      });

      inc(input.updated, "athletes");

      const cached = input.athletesById.get(updatedRecord.id);
      if (cached) {
        cached.nameDisplay = updatedRecord.nameDisplay;
        cached.rankingPoints = updatedRecord.rankingPoints;
        cached.ratingPoints = updatedRecord.ratingPoints;
        cached.createdFromWarning = false;
        cached.clubId = updatedRecord.clubId;
        cached.clubNormalizedName = input.club.normalizedName;
        cached.stateCode = updatedRecord.stateCode;
        cached.stateName = updatedRecord.stateName;
        cached.region = updatedRecord.region;
        return cached;
      }

      const createdCache: CachedAthlete = {
        id: updatedRecord.id,
        eventId: updatedRecord.eventId,
        clubId: updatedRecord.clubId,
        clubNormalizedName: input.club.normalizedName,
        stateCode: updatedRecord.stateCode,
        stateName: updatedRecord.stateName,
        region: updatedRecord.region,
        nameDisplay: updatedRecord.nameDisplay,
        nameNormalized: updatedRecord.nameNormalized,
        rankingPoints: updatedRecord.rankingPoints,
        ratingPoints: updatedRecord.ratingPoints,
        createdFromWarning: updatedRecord.createdFromWarning,
        aliases: new Set([updatedRecord.nameNormalized]),
      };
      input.athletesById.set(createdCache.id, createdCache);
      return createdCache;
    }

    const inferredFederation = inferAthleteFederationFromClub({
      eventLevel: input.eventLevel,
      clubName: input.club.name,
      current: null,
    });
    if (inferredFederation.warning) {
      const warningKey = `${input.eventId}|${input.club.normalizedName}`;
      if (!input.federationWarningKeys.has(warningKey)) {
        input.federationWarningKeys.add(warningKey);
        input.warnings.push(
          `Nao foi possivel inferir UF/regiao pelo clube '${input.club.name}' no evento ${input.eventId}.`,
        );
      }
    }
    if (inferredFederation.source === "club_exception") {
      const warningKey = `${input.eventId}|${input.club.normalizedName}|club_exception`;
      if (!input.federationWarningKeys.has(warningKey)) {
        input.federationWarningKeys.add(warningKey);
        input.warnings.push(
          `UF/regiao inferida por excecao de clube para '${input.club.name}' no evento ${input.eventId}.`,
        );
      }
    }

    const created = await prisma.athlete.create({
      data: {
        eventId: input.eventId,
        clubId: input.club.id,
        nameDisplay: input.nameDisplay,
        nameNormalized: input.nameNormalized,
        rankingPoints: input.rankingPoints,
        ratingPoints: input.ratingPoints,
        createdFromWarning: false,
        stateCode: inferredFederation.next?.stateCode ?? null,
        stateName: inferredFederation.next?.stateName ?? null,
        region: inferredFederation.next?.region ?? null,
      },
    });

    inc(input.inserted, "athletes");

    const cacheAthlete: CachedAthlete = {
      id: created.id,
      eventId: created.eventId,
      clubId: created.clubId,
      clubNormalizedName: input.club.normalizedName,
      stateCode: created.stateCode,
      stateName: created.stateName,
      region: created.region,
      nameDisplay: created.nameDisplay,
      nameNormalized: created.nameNormalized,
      rankingPoints: created.rankingPoints,
      ratingPoints: created.ratingPoints,
      createdFromWarning: created.createdFromWarning,
      aliases: new Set([created.nameNormalized]),
    };

    input.athletesById.set(cacheAthlete.id, cacheAthlete);
    return cacheAthlete;
  }

  private async ensureAthleteAlias(input: {
    athleteId: number;
    aliasDisplay: string;
    aliasNormalized: string;
    source: AliasSource;
    inserted: Record<string, number>;
    updated: Record<string, number>;
    athletesById: Map<number, CachedAthlete>;
    aliasToAthleteIds: Map<string, Set<number>>;
  }): Promise<void> {
    if (!input.aliasNormalized) {
      return;
    }

    const athlete = input.athletesById.get(input.athleteId);
    if (!athlete) {
      return;
    }

    if (athlete.aliases.has(input.aliasNormalized)) {
      this.indexAlias(input.aliasToAthleteIds, input.aliasNormalized, input.athleteId);
      return;
    }

    const existing = await prisma.athleteAlias.findUnique({
      where: {
        athleteId_aliasNormalized: {
          athleteId: input.athleteId,
          aliasNormalized: input.aliasNormalized,
        },
      },
    });

    if (existing) {
      if (existing.aliasDisplay !== input.aliasDisplay || existing.source !== input.source) {
        await prisma.athleteAlias.update({
          where: { id: existing.id },
          data: {
            aliasDisplay: input.aliasDisplay,
            source: input.source,
          },
        });
        inc(input.updated, "athlete_aliases");
      }
    } else {
      await prisma.athleteAlias.create({
        data: {
          athleteId: input.athleteId,
          aliasDisplay: input.aliasDisplay,
          aliasNormalized: input.aliasNormalized,
          source: input.source,
        },
      });
      inc(input.inserted, "athlete_aliases");
    }

    athlete.aliases.add(input.aliasNormalized);
    this.indexAlias(input.aliasToAthleteIds, input.aliasNormalized, input.athleteId);
  }

  private buildResolverCandidates(
    eventId: number,
    athletesById: Map<number, CachedAthlete>,
    categoryAthleteIds?: Set<number> | null,
  ): AthleteResolverCandidate[] {
    const candidates: AthleteResolverCandidate[] = [];

    for (const athlete of athletesById.values()) {
      if (athlete.eventId !== eventId || athlete.createdFromWarning) {
        continue;
      }
      if (categoryAthleteIds && !categoryAthleteIds.has(athlete.id)) {
        continue;
      }

      candidates.push({
        athleteId: athlete.id,
        eventId: athlete.eventId,
        nameDisplay: athlete.nameDisplay,
        nameNormalized: athlete.nameNormalized,
        rankingPoints: athlete.rankingPoints,
        ratingPoints: athlete.ratingPoints,
        clubNormalizedName: athlete.clubNormalizedName,
        aliasesNormalized: [...athlete.aliases],
      });
    }

    return candidates;
  }

  private async resolveMatchAthlete(input: ResolveMatchAthleteInput): Promise<CachedAthlete | null> {
    const shortName = compactWhitespace(input.shortName);
    const shortNameNormalized = normalizeText(shortName);
    if ((input.participantRefType ?? "REAL") !== "REAL" || isBracketReferenceToken(shortName)) {
      return null;
    }
    const context = `${input.matchKey}:${input.side}`;
    const conflictKey = conflictCacheKey(context, shortNameNormalized);

    const existingConflict = input.conflictsByKey.get(conflictKey);
    if (existingConflict?.resolvedAthleteId) {
      const resolvedAthlete = await this.getAthleteById(
        existingConflict.resolvedAthleteId,
        input.athletesById,
      );

      if (resolvedAthlete) {
        await this.reconcileAthletePoints(
          resolvedAthlete,
          input.rankingPoints,
          input.ratingPoints,
          input.updated,
        );

        await this.ensureAthleteAlias({
          athleteId: resolvedAthlete.id,
          aliasDisplay: shortName,
          aliasNormalized: shortNameNormalized,
          source: "JOGOS",
          inserted: input.inserted,
          updated: input.updated,
          athletesById: input.athletesById,
          aliasToAthleteIds: input.aliasToAthleteIds,
        });

        return resolvedAthlete;
      }
    }

    let eventAliasHomonymAmbiguous = false;
    const resolveEventAliasHomonymCollision = (): CachedAthlete | null => {
      const aliasBucket = input.aliasToAthleteIds.get(shortNameNormalized);
      if (!aliasBucket || aliasBucket.size <= 1) {
        return null;
      }

      const homonyms: CachedAthlete[] = [];
      for (const athleteId of aliasBucket) {
        const athlete = input.athletesById.get(athleteId);
        if (!athlete || athlete.eventId !== input.eventId || athlete.createdFromWarning) {
          continue;
        }
        homonyms.push(athlete);
      }

      if (homonyms.length <= 1) {
        return homonyms[0] ?? null;
      }

      let narrowed = homonyms;
      if (input.clubNormalizedName) {
        const byClub = narrowed.filter((candidate) => candidate.clubNormalizedName === input.clubNormalizedName);
        if (byClub.length === 1) {
          return byClub[0];
        }
        if (byClub.length > 1) {
          narrowed = byClub;
        }
      }

      if (Number.isInteger(input.rankingPoints) && Number.isInteger(input.ratingPoints)) {
        const byBothPoints = narrowed.filter(
          (candidate) =>
            candidate.rankingPoints === input.rankingPoints && candidate.ratingPoints === input.ratingPoints,
        );
        if (byBothPoints.length === 1) {
          return byBothPoints[0];
        }
        if (byBothPoints.length > 1) {
          narrowed = byBothPoints;
        }
      }

      if (Number.isInteger(input.ratingPoints)) {
        const byRating = narrowed.filter((candidate) => candidate.ratingPoints === input.ratingPoints);
        if (byRating.length === 1) {
          return byRating[0];
        }
        if (byRating.length > 1) {
          narrowed = byRating;
        }
      }

      if (Number.isInteger(input.rankingPoints)) {
        const byRanking = narrowed.filter((candidate) => candidate.rankingPoints === input.rankingPoints);
        if (byRanking.length === 1) {
          return byRanking[0];
        }
      }

      eventAliasHomonymAmbiguous = true;
      return null;
    };

    const eventAliasResolvedAthlete = resolveEventAliasHomonymCollision();
    if (eventAliasResolvedAthlete) {
      await this.reconcileAthletePoints(
        eventAliasResolvedAthlete,
        input.rankingPoints,
        input.ratingPoints,
        input.updated,
      );

      await this.ensureAthleteAlias({
        athleteId: eventAliasResolvedAthlete.id,
        aliasDisplay: shortName,
        aliasNormalized: shortNameNormalized,
        source: "JOGOS",
        inserted: input.inserted,
        updated: input.updated,
        athletesById: input.athletesById,
        aliasToAthleteIds: input.aliasToAthleteIds,
      });

      return eventAliasResolvedAthlete;
    }

    let categoryAliasAmbiguous = false;
    const resolveCategoryAliasCollision = (): CachedAthlete | null => {
      if (!input.categoryAthleteIds || input.categoryAthleteIds.size === 0) {
        return null;
      }

      const candidates: CachedAthlete[] = [];
      for (const athleteId of input.categoryAthleteIds) {
        const athlete = input.athletesById.get(athleteId);
        if (!athlete || athlete.eventId !== input.eventId || athlete.createdFromWarning) {
          continue;
        }

        const reducedAlias = toReducedAliasNormalized(athlete.nameDisplay);
        if (athlete.aliases.has(shortNameNormalized) || reducedAlias === shortNameNormalized) {
          candidates.push(athlete);
        }
      }

      if (candidates.length <= 1) {
        return candidates[0] ?? null;
      }
      categoryAliasAmbiguous = true;

      // Em colisão de nome reduzido na mesma categoria, só resolve automaticamente com discriminador forte.
      let narrowed = candidates;
      if (input.clubNormalizedName) {
        const byClub = narrowed.filter((candidate) => candidate.clubNormalizedName === input.clubNormalizedName);
        if (byClub.length === 1) {
          return byClub[0];
        }
        if (byClub.length > 1) {
          narrowed = byClub;
        }
      }

      if (Number.isInteger(input.rankingPoints)) {
        const byRanking = narrowed.filter((candidate) => candidate.rankingPoints === input.rankingPoints);
        if (byRanking.length === 1) {
          return byRanking[0];
        }
        if (byRanking.length > 1) {
          narrowed = byRanking;
        }
      }

      if (Number.isInteger(input.ratingPoints)) {
        const byRating = narrowed.filter((candidate) => candidate.ratingPoints === input.ratingPoints);
        if (byRating.length === 1) {
          categoryAliasAmbiguous = false;
          return byRating[0];
        }
        if (byRating.length > 1) {
          narrowed = byRating;
        }
      }

      return null;
    };

    const collidedResolvedAthlete = resolveCategoryAliasCollision();
    if (collidedResolvedAthlete) {
      await this.reconcileAthletePoints(
        collidedResolvedAthlete,
        input.rankingPoints,
        input.ratingPoints,
        input.updated,
      );

      await this.ensureAthleteAlias({
        athleteId: collidedResolvedAthlete.id,
        aliasDisplay: shortName,
        aliasNormalized: shortNameNormalized,
        source: "JOGOS",
        inserted: input.inserted,
        updated: input.updated,
        athletesById: input.athletesById,
        aliasToAthleteIds: input.aliasToAthleteIds,
      });

      return collidedResolvedAthlete;
    }

    let resolverCandidates = this.buildResolverCandidates(
      input.eventId,
      input.athletesById,
      input.categoryAthleteIds,
    );
    if (resolverCandidates.length === 0) {
      // Fallback: mantém comportamento anterior quando a categoria ainda não possui vínculos pré-cadastrados.
      resolverCandidates = this.buildResolverCandidates(input.eventId, input.athletesById);
    }

    const decision = resolveAthleteCandidate({
      eventId: input.eventId,
      shortName,
      shortNameNormalized,
      rankingPoints: input.rankingPoints,
      ratingPoints: input.ratingPoints,
      clubNormalizedName: input.clubNormalizedName,
      candidates: resolverCandidates,
    });

    if (!categoryAliasAmbiguous && !eventAliasHomonymAmbiguous && decision.status === "resolved" && decision.athleteId) {
      const resolvedAthlete = await this.getAthleteById(decision.athleteId, input.athletesById);
      if (resolvedAthlete) {
        await this.reconcileAthletePoints(
          resolvedAthlete,
          input.rankingPoints,
          input.ratingPoints,
          input.updated,
        );

        await this.ensureAthleteAlias({
          athleteId: resolvedAthlete.id,
          aliasDisplay: shortName,
          aliasNormalized: shortNameNormalized,
          source: "JOGOS",
          inserted: input.inserted,
          updated: input.updated,
          athletesById: input.athletesById,
          aliasToAthleteIds: input.aliasToAthleteIds,
        });

        if (existingConflict && !existingConflict.resolvedAthleteId) {
          await prisma.athleteMatchConflict.update({
            where: { id: existingConflict.id },
            data: {
              resolvedAthleteId: resolvedAthlete.id,
              resolvedAt: new Date(),
              candidateAthletes: {
                matchKey: input.matchKey,
                side: input.side,
                candidates: decision.scoredCandidates.slice(0, 10),
                strategy: decision.strategy,
              } as any,
            },
          });
          inc(input.updated, "athlete_conflicts");

          existingConflict.resolvedAthleteId = resolvedAthlete.id;
        }

        return resolvedAthlete;
      }
    }

    const payload = {
      matchKey: input.matchKey,
      side: input.side,
      categoryName: input.categoryName,
      shortName,
      shortNameNormalized,
      participantRefType: input.participantRefType ?? "REAL",
      observedRankingPoints: input.rankingPoints,
      observedRatingPoints: input.ratingPoints,
      observedClubNormalizedName: input.clubNormalizedName,
      strategy: decision.strategy,
      candidates: decision.scoredCandidates.slice(0, 10).map((candidate) => ({
        athleteId: candidate.athleteId,
        nameDisplay: candidate.nameDisplay,
        rankingPoints: candidate.rankingPoints,
        ratingPoints: candidate.ratingPoints,
        score: candidate.score,
        reasons: candidate.reasons,
      })),
    };

    if (existingConflict) {
      await prisma.athleteMatchConflict.update({
        where: { id: existingConflict.id },
        data: {
          candidateAthletes: payload,
        },
      });
      inc(input.updated, "athlete_conflicts");
    } else {
      const conflict = await prisma.athleteMatchConflict.create({
        data: {
          eventId: input.eventId,
          context,
          shortName,
          shortNameNormalized,
          candidateAthletes: payload,
        },
      });
      inc(input.inserted, "athlete_conflicts");

      input.conflictsByKey.set(conflictKey, {
        id: conflict.id,
        context: conflict.context,
        shortNameNormalized: conflict.shortNameNormalized,
        resolvedAthleteId: conflict.resolvedAthleteId,
        candidateAthletes: conflict.candidateAthletes,
      });
    }

    input.warnings.push(
      `Conflito de atleta (${input.categoryName}) em ${context}: '${shortName}' não pôde ser resolvido automaticamente.`,
    );

    return null;
  }

  private async reconcileAthletePoints(
    athlete: CachedAthlete,
    observedRanking: number | null,
    observedRating: number | null,
    updated: Record<string, number>,
  ): Promise<void> {
    const mergedRanking = mergePointValue(athlete.rankingPoints, observedRanking);
    const mergedRating = mergePointValue(athlete.ratingPoints, observedRating);

    if (mergedRanking === athlete.rankingPoints && mergedRating === athlete.ratingPoints) {
      return;
    }

    await prisma.athlete.update({
      where: { id: athlete.id },
      data: {
        rankingPoints: mergedRanking,
        ratingPoints: mergedRating,
      },
    });

    athlete.rankingPoints = mergedRanking;
    athlete.ratingPoints = mergedRating;
    inc(updated, "athletes_points_reconciled");
  }

  private async cleanupNonRealAthleteRecords(input: {
    eventId: number;
    athletesById: Map<number, CachedAthlete>;
    aliasToAthleteIds: Map<string, Set<number>>;
    updated: Record<string, number>;
  }): Promise<void> {
    const placeholderIds = [...input.athletesById.values()]
      .filter(
        (athlete) =>
          athlete.eventId === input.eventId &&
          athlete.createdFromWarning &&
          isBracketReferenceToken(athlete.nameDisplay),
      )
      .map((athlete) => athlete.id);

    if (placeholderIds.length === 0) {
      return;
    }

    await prisma.matchParticipant.deleteMany({
      where: {
        athleteId: {
          in: placeholderIds,
        },
      },
    });

    await prisma.athleteCategory.deleteMany({
      where: {
        athleteId: {
          in: placeholderIds,
        },
      },
    });

    await prisma.athleteAlias.deleteMany({
      where: {
        athleteId: {
          in: placeholderIds,
        },
      },
    });

    await prisma.athleteMatchConflict.updateMany({
      where: {
        eventId: input.eventId,
        resolvedAthleteId: {
          in: placeholderIds,
        },
      },
      data: {
        resolvedAthleteId: null,
        resolvedAt: null,
      },
    });

    await prisma.athlete.deleteMany({
      where: {
        id: {
          in: placeholderIds,
        },
      },
    });

    for (const athleteId of placeholderIds) {
      const athlete = input.athletesById.get(athleteId);
      if (!athlete) {
        continue;
      }
      for (const alias of athlete.aliases) {
        const ids = input.aliasToAthleteIds.get(alias);
        if (!ids) {
          continue;
        }
        ids.delete(athleteId);
        if (ids.size === 0) {
          input.aliasToAthleteIds.delete(alias);
        }
      }
      input.athletesById.delete(athleteId);
    }

    input.updated.athletes_placeholders_removed =
      (input.updated.athletes_placeholders_removed ?? 0) + placeholderIds.length;
  }

  private async getAthleteById(
    athleteId: number,
    athletesById: Map<number, CachedAthlete>,
  ): Promise<CachedAthlete | null> {
    const cached = athletesById.get(athleteId);
    if (cached) {
      return cached;
    }

    const athlete = await prisma.athlete.findUnique({
      where: { id: athleteId },
      include: {
        club: true,
        aliases: true,
      },
    });

    if (!athlete) {
      return null;
    }

    const hydrated: CachedAthlete = {
      id: athlete.id,
      eventId: athlete.eventId,
      clubId: athlete.clubId,
      clubNormalizedName: athlete.club?.normalizedName ?? null,
      stateCode: athlete.stateCode,
      stateName: athlete.stateName,
      region: athlete.region,
      nameDisplay: athlete.nameDisplay,
      nameNormalized: athlete.nameNormalized,
      rankingPoints: athlete.rankingPoints,
      ratingPoints: athlete.ratingPoints,
      createdFromWarning: athlete.createdFromWarning,
      aliases: new Set<string>([
        athlete.nameNormalized,
        ...athlete.aliases.map((alias) => alias.aliasNormalized),
      ]),
    };

    athletesById.set(hydrated.id, hydrated);
    return hydrated;
  }

  private indexAlias(aliasToAthleteIds: Map<string, Set<number>>, aliasNormalized: string, athleteId: number): void {
    const key = normalizeText(aliasNormalized);
    if (!key) {
      return;
    }

    const bucket = aliasToAthleteIds.get(key) ?? new Set<number>();
    bucket.add(athleteId);
    aliasToAthleteIds.set(key, bucket);
  }
}


