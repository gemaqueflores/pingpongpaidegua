import { createHash } from "node:crypto";
import {
  AthleteResolverCandidate,
  EventSituation,
  ParsedDataset,
  ParsedMatch,
  ParsedMatchSet,
  compactWhitespace,
  computeEventSituation,
  normalizeRegistrationStatus,
  normalizeAthleteName,
  normalizeText,
  resolveAthleteCandidate,
} from "@cbtm/shared";
import { AliasSource, Athlete, EventLevel, MatchPhase, Prisma, RegistrationStatus } from "@prisma/client";
import { config } from "../config";
import { prisma } from "../prisma";
import { buildResolverCandidates, resolveByCategoryHistory } from "./athlete-resolution";
import { inferAthleteFederationFromClub } from "./athlete-federation";
import { canonicalizeDatasetCategoryNames, canonicalizeEventScopedCategoryName } from "./category-labels";
import { extractCbtmMatchId, mergeMatchesAcrossSources } from "./match-merge";
import { applyParenseEligibilityScopeToDataset, DatasetScopeStats } from "./parense-scope";
import {
  computeEventRegistrationPairRemovals,
  detectRegistrationCategoryCancellation,
  detectRegistrationCategoryMerge,
  shouldAllowDestructiveRegistrationSync,
  shouldSyncRegistrationSnapshot,
} from "./registration-snapshot";
import { parseScoreRaw } from "./score-parser";

interface UpsertResult {
  inserted: Record<string, number>;
  updated: Record<string, number>;
  warnings: string[];
  extractionStats: ParsedDataset["extractionStats"] & {
    registrationSync?: RegistrationSyncExtractionStats;
  };
}

interface UpsertOptions {
  processRegistrations?: boolean;
  authoritativeRegistrationAbsence?: boolean;
  observedRegistrationCategoryIds?: Set<string>;
  observedRegistrationCategoryNames?: Set<string>;
}

export function shouldPruneStage3StaleMatches(input: {
  pruneEnabled: boolean;
  processRegistrations: boolean;
  eventConcluded: boolean;
}): boolean {
  return input.pruneEnabled && !input.processRegistrations && input.eventConcluded;
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
  clubsByNormalized: Map<string, CachedClub>;
  athletesById: Map<number, CachedAthlete>;
  aliasToAthleteIds: Map<string, Set<number>>;
  conflictsByKey: Map<string, CachedConflict>;
  categoryAthleteIds: Set<number> | null;
  categoryAliasHistoryCounts: Map<number, number> | null;
  autoCreateWarningAthlete: boolean;
  globalAliasHintsByAlias: Map<string, string[]>;
  participantRefType?: "REAL" | "GROUP_SLOT" | "WINNER_SLOT";
}

interface CategoryIdentityRow {
  id: number;
  normalizedName: string;
  cbtmCategoryId: string | null;
}

interface ObservedRegistrationCategoryStats {
  categoryName: string;
  total: number;
  inscrito: number;
  preInscrito: number;
  outro: number;
  unknown: number;
}

interface RegistrationSyncExtractionStats {
  categoryHashes: Record<string, string>;
  categoryCoverage: Record<string, number>;
  categoryGapTotals: Record<string, number>;
  categoriesConfirmedForRemoval: string[];
  categoriesBlockedByConfirmation: string[];
  categoriesBlockedByCoverage: string[];
}

interface ObservedRegistrationPair {
  athleteId: number;
  categoryId: number;
  categoryName: string;
  registrationStatus: RegistrationStatus | null;
}

function inc(target: Record<string, number>, key: string): void {
  target[key] = (target[key] ?? 0) + 1;
}

function buildParsedCategoryKey(input: {
  categoryId: string | null | undefined;
  categoryNormalizedName: string | null | undefined;
  categoryName: string | null | undefined;
}): string | null {
  const categoryId = compactWhitespace(input.categoryId ?? "");
  if (categoryId) {
    return `id:${categoryId}`;
  }
  const normalized =
    normalizeText(input.categoryNormalizedName) || normalizeText(input.categoryName) || null;
  if (!normalized) {
    return null;
  }
  return `name:${normalized}`;
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

function mergeAthleteIdSets(sets: Array<Set<number> | undefined | null>): Set<number> {
  const merged = new Set<number>();
  for (const set of sets) {
    if (!set || set.size === 0) {
      continue;
    }
    for (const athleteId of set) {
      merged.add(athleteId);
    }
  }
  return merged;
}

function tokenizeReducedName(nameNormalized: string): string[] {
  return normalizeAthleteName(nameNormalized)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

function athleteNameContainsAllReducedTokens(
  shortNameNormalized: string,
  athleteNameDisplay: string,
): boolean {
  const shortTokens = tokenizeReducedName(shortNameNormalized);
  if (shortTokens.length === 0) {
    return false;
  }
  const athleteTokens = new Set(
    normalizeAthleteName(athleteNameDisplay)
      .split(" ")
      .map((token) => token.trim())
      .filter(Boolean),
  );

  return shortTokens.every((token) => athleteTokens.has(token));
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

function extractCrossCategoryHash(matchKey: string): string {
  const normalized = String(matchKey ?? "").trim();
  const scoped = normalized.match(/^cat:[^|]+\|(.+)$/);
  return scoped?.[1] ?? normalized;
}

function getMatchCategoryKey(match: ParsedMatch): string {
  if (match.categoryId) {
    return `id:${match.categoryId}`;
  }
  return `name:${match.categoryNormalizedName}`;
}

function withCategoryScopedMatchKey(match: ParsedMatch): ParsedMatch {
  const categoryScope = match.categoryId
    ? `cat:id:${String(match.categoryId).trim()}`
    : `cat:name:${normalizeText(match.categoryNormalizedName) || "desconhecida"}`;
  const currentKey = String(match.matchKey ?? "").trim();
  return {
    ...match,
    matchKey: currentKey.startsWith(`${categoryScope}|`) ? currentKey : `${categoryScope}|${currentKey}`,
  };
}

function getCategoryAthletePool(input: {
  category: CachedCategory;
  athleteIdsByCategoryId: Map<number, Set<number>>;
  athleteIdsByCategoryCbtmId: Map<string, Set<number>>;
  athleteIdsByCategoryNormalizedName: Map<string, Set<number>>;
}): Set<number> | null {
  const byId = input.athleteIdsByCategoryId.get(input.category.id);
  if (byId && byId.size > 0) {
    return byId;
  }

  const cbtmKey = String(input.category.cbtmCategoryId ?? "").trim();
  const byCbtmId = cbtmKey ? input.athleteIdsByCategoryCbtmId.get(cbtmKey) : undefined;
  if (byCbtmId && byCbtmId.size > 0) {
    return byCbtmId;
  }

  const normalizedKey = normalizeText(input.category.normalizedName);
  const byNormalized = normalizedKey
    ? input.athleteIdsByCategoryNormalizedName.get(normalizedKey)
    : undefined;
  if (byNormalized && byNormalized.size > 0) {
    return byNormalized;
  }

  const merged = mergeAthleteIdSets([byId, byCbtmId, byNormalized]);
  return merged.size > 0 ? merged : null;
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

function buildEventAthleteLinkKey(nameNormalized: string, clubNormalizedName: string | null): string {
  const clubKey = normalizeText(clubNormalizedName ?? "") || "sem-clube";
  return `${nameNormalized}|${clubKey}`;
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
    const roundKey = normalizeText(match.round) || "sem-rodada";
    const gameId = extractGameId(match) ?? "sem-jogo";

    return [
      getMatchCategoryKey(match),
      getMatchParticipantsKey(match),
      timestamp,
      match.tableNumber ?? "sem-mesa",
      normalizeText(match.scoreRaw),
      `round:${roundKey}`,
      `game:${gameId}`,
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
  private static readonly REGISTRATION_SYNC_MIN_CATEGORY_COVERAGE = 0.85;
  private static readonly REGISTRATION_SYNC_PREVIOUS_RUN_LOOKBACK = 30;

  private async applyParenseEligibilityScope(input: {
    eventLevel: EventLevel | null;
    eventName: string | null;
    dataset: ParsedDataset;
    warnings: string[];
  }): Promise<{ dataset: ParsedDataset; stats: DatasetScopeStats }> {
    const eligibleClubRows = await prisma.athlete.findMany({
      where: {
        event: {
          nivel: { in: ["ESTADUAL", "OPEN"] },
        },
      },
      distinct: ["clubId"],
      select: {
        club: {
          select: {
            normalizedName: true,
          },
        },
      },
    });
    const eligibleClubNames = new Set(
      eligibleClubRows
        .map((row) => normalizeText(row.club.normalizedName))
        .filter(Boolean),
    );
    return applyParenseEligibilityScopeToDataset({
      eventLevel: input.eventLevel,
      eventName: input.eventName,
      dataset: input.dataset,
      eligibleClubNames,
      warnings: input.warnings,
    });
  }

  private deduplicateCrossCategoryHashMatches(input: {
    matches: ParsedMatch[];
    categoriesByCbtmId: Map<string, CachedCategory>;
    athleteIdsByCategoryCbtmId: Map<string, Set<number>>;
    aliasToAthleteIds: Map<string, Set<number>>;
    athletesById: Map<number, CachedAthlete>;
  }): { matches: ParsedMatch[]; removed: number; droppedMatchKeys: string[]; warnings: string[] } {
    const groups = new Map<string, ParsedMatch[]>();
    for (const match of input.matches) {
      const key = extractCrossCategoryHash(match.matchKey);
      const bucket = groups.get(key) ?? [];
      bucket.push(match);
      groups.set(key, bucket);
    }

    const selected: ParsedMatch[] = [];
    const dropped = new Set<string>();
    let crossCategoryGroups = 0;

    const scoreMatchForCategoryPool = (match: ParsedMatch): number => {
      const cbtmCategoryId = compactWhitespace(match.categoryId ?? "");
      if (!cbtmCategoryId) {
        return 0;
      }
      const category = input.categoriesByCbtmId.get(cbtmCategoryId);
      if (!category) {
        return 0;
      }
      const categoryPool = input.athleteIdsByCategoryCbtmId.get(String(category.cbtmCategoryId ?? "").trim());
      if (!categoryPool || categoryPool.size === 0) {
        return 0;
      }

      const names = [
        match.athleteANormalizedName || normalizeText(match.athleteAName),
        match.athleteBNormalizedName || normalizeText(match.athleteBName),
      ].filter(Boolean);
      if (names.length === 0) {
        return 0;
      }

      let score = 0;
      for (const shortName of names) {
        const aliasBucket = input.aliasToAthleteIds.get(shortName);
        if (!aliasBucket || aliasBucket.size === 0) {
          continue;
        }
        const compatible = [...aliasBucket].some((athleteId) => {
          if (!categoryPool.has(athleteId)) {
            return false;
          }
          const athlete = input.athletesById.get(athleteId);
          if (!athlete) {
            return false;
          }
          return athleteNameContainsAllReducedTokens(shortName, athlete.nameDisplay);
        });
        if (compatible) {
          score += 1;
        }
      }
      return score;
    };

    for (const bucket of groups.values()) {
      if (bucket.length <= 1) {
        selected.push(bucket[0]);
        continue;
      }

      const distinctCategories = new Set(
        bucket.map((match) => compactWhitespace(match.categoryId ?? "") || match.categoryNormalizedName || "sem"),
      );
      if (distinctCategories.size <= 1) {
        let winner = bucket[0];
        for (let i = 1; i < bucket.length; i += 1) {
          winner = selectPreferredMatch(winner, bucket[i]);
        }
        selected.push(winner);
        for (const item of bucket) {
          if (item.matchKey !== winner.matchKey) {
            dropped.add(item.matchKey);
          }
        }
        continue;
      }

      crossCategoryGroups += 1;
      let winner = bucket[0];
      let winnerScore = scoreMatchForCategoryPool(winner);
      for (let i = 1; i < bucket.length; i += 1) {
        const candidate = bucket[i];
        const candidateScore = scoreMatchForCategoryPool(candidate);
        if (candidateScore > winnerScore) {
          winner = candidate;
          winnerScore = candidateScore;
          continue;
        }
        if (candidateScore === winnerScore) {
          winner = selectPreferredMatch(winner, candidate);
          winnerScore = scoreMatchForCategoryPool(winner);
        }
      }

      selected.push(winner);
      for (const item of bucket) {
        if (item.matchKey !== winner.matchKey) {
          dropped.add(item.matchKey);
        }
      }
    }

    const selectedKeys = new Set(selected.map((item) => item.matchKey));
    const droppedMatchKeys = [...dropped].filter((key) => !selectedKeys.has(key));
    const warnings: string[] = [];
    if (crossCategoryGroups > 0 || droppedMatchKeys.length > 0) {
      warnings.push(
        `Deduplicação cross-category colapsou ${crossCategoryGroups} grupo(s) de hash repetido entre categorias; removidos ${droppedMatchKeys.length} registro(s).`,
      );
    }

    return {
      matches: selected,
      removed: input.matches.length - selected.length,
      droppedMatchKeys,
      warnings,
    };
  }

  async upsert(eventId: number, dataset: ParsedDataset, options?: UpsertOptions): Promise<UpsertResult> {
    const processRegistrations = options?.processRegistrations ?? true;
    const authoritativeRegistrationAbsence = options?.authoritativeRegistrationAbsence ?? false;
    const observedRegistrationCategoryIds = options?.observedRegistrationCategoryIds ?? new Set<string>();
    const observedRegistrationCategoryNames = options?.observedRegistrationCategoryNames ?? new Set<string>();
    const inserted: Record<string, number> = {};
    const updated: Record<string, number> = {};
    const warnings: string[] = [...dataset.warnings];

    const clubsByNormalized = new Map<string, CachedClub>();
    const categoriesByNormalized = new Map<string, CachedCategory>();
    const categoriesByCbtmId = new Map<string, CachedCategory>();
    const athletesById = new Map<number, CachedAthlete>();
    const aliasToAthleteIds = new Map<string, Set<number>>();
    const conflictsByKey = new Map<string, CachedConflict>();
    const globalAliasHintsByAlias = new Map<string, string[]>();
    const federationWarningKeys = new Set<string>();
    const observedRegistrationPairs = new Map<string, ObservedRegistrationPair>();

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: {
        nome: true,
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
    const scopeResult = await this.applyParenseEligibilityScope({
      eventLevel: event?.nivel ?? null,
      eventName: event?.nome ?? null,
      dataset,
      warnings,
    });
    dataset = canonicalizeDatasetCategoryNames(event?.nome ?? null, scopeResult.dataset);
    const allowAutoCreateWarningAthlete =
      config.conflictAutoCreateWarningAthleteEnabled &&
      Boolean(event?.concluido);

    if (processRegistrations) {
      await this.reconcileCategoriesWithSource(eventId, dataset.categories, updated, warnings);
      await this.repairMisnormalizedCategories(eventId, updated, warnings);
      await this.repairEventScopedCategoryAliases(eventId, event?.nome ?? null, updated, warnings);
    }

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
        processRegistrations,
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
          true,
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

    let registrationSyncStats: RegistrationSyncExtractionStats | undefined;
    if (
      processRegistrations &&
      shouldSyncRegistrationSnapshot({
        eventConcluded: Boolean(event?.concluido),
        eventSituation,
        registrationCount: dataset.registrations.length,
      })
    ) {
      registrationSyncStats = await this.syncMutableRegistrationCategories({
        eventId,
        observedRegistrationPairs,
        authoritativeRegistrationAbsence,
        observedRegistrationCategoryIds,
        observedRegistrationCategoryNames,
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

      await this.sanitizeRegistrationOrphanCategories({
        eventId,
        observedCategoryIds: new Set(observedRegistrationStatsByCategory.keys()),
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
    const categoryIdentityRows: CategoryIdentityRow[] = await prisma.category.findMany({
      where: { eventId },
      select: {
        id: true,
        normalizedName: true,
        cbtmCategoryId: true,
      },
    });
    const categoryIdentityById = new Map<number, CategoryIdentityRow>(
      categoryIdentityRows.map((row) => [row.id, row] as const),
    );
    for (const row of persistedAthleteCategories) {
      const bucket = athleteIdsByCategoryId.get(row.categoryId) ?? new Set<number>();
      bucket.add(row.athleteId);
      athleteIdsByCategoryId.set(row.categoryId, bucket);
    }
    const athleteIdsByCategoryCbtmId = new Map<string, Set<number>>();
    const athleteIdsByCategoryNormalizedName = new Map<string, Set<number>>();
    for (const [categoryId, athleteIds] of athleteIdsByCategoryId.entries()) {
      const categoryIdentity = categoryIdentityById.get(categoryId);
      if (!categoryIdentity) {
        continue;
      }
      const cbtmKey = String(categoryIdentity.cbtmCategoryId ?? "").trim();
      if (cbtmKey) {
        const bucket = athleteIdsByCategoryCbtmId.get(cbtmKey) ?? new Set<number>();
        for (const athleteId of athleteIds) {
          bucket.add(athleteId);
        }
        athleteIdsByCategoryCbtmId.set(cbtmKey, bucket);
      }
      const normalizedKey = normalizeText(categoryIdentity.normalizedName);
      if (normalizedKey) {
        const bucket = athleteIdsByCategoryNormalizedName.get(normalizedKey) ?? new Set<number>();
        for (const athleteId of athleteIds) {
          bucket.add(athleteId);
        }
        athleteIdsByCategoryNormalizedName.set(normalizedKey, bucket);
      }
    }
    const categoryAliasHistoryCounts = await this.buildCategoryAliasHistoryCounts(eventId, athletesById);
    const activeConflictContexts = new Set<string>();
    const emptyResolverPoolByCategory = new Map<string, number>();

    const categoryScopedMatches = dataset.matches.map((match) => withCategoryScopedMatchKey(match));
    const mergedMatches = mergeMatchesAcrossSources(eventId, categoryScopedMatches);
    warnings.push(...mergedMatches.warnings);
    const dedupedMatches = deduplicateParsedMatches(mergedMatches.matches);
    const crossCategoryDedup = this.deduplicateCrossCategoryHashMatches({
      matches: dedupedMatches.matches,
      categoriesByCbtmId,
      athleteIdsByCategoryCbtmId,
      aliasToAthleteIds,
      athletesById,
    });
    warnings.push(...crossCategoryDedup.warnings);
    const dedupedMatchesFinal: DedupedMatchesResult = {
      matches: crossCategoryDedup.matches,
      removed: dedupedMatches.removed + crossCategoryDedup.removed,
      droppedMatchKeys: [...new Set([...dedupedMatches.droppedMatchKeys, ...crossCategoryDedup.droppedMatchKeys])],
    };

    if (dedupedMatchesFinal.removed > 0) {
      const mergedByKey = new Map(
        mergedMatches.matches.map((match) => [match.matchKey, match] as const),
      );
      const droppedByCategory = new Map<string, number>();
      for (const matchKey of dedupedMatchesFinal.droppedMatchKeys) {
        const dropped = mergedByKey.get(matchKey);
        const categoryLabel = compactWhitespace(
          dropped?.categoryName ??
            dropped?.categoryNormalizedName ??
            dropped?.categoryId ??
            "CATEGORIA_DESCONHECIDA",
        );
        droppedByCategory.set(categoryLabel, (droppedByCategory.get(categoryLabel) ?? 0) + 1);
      }
      const droppedTop = [...droppedByCategory.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([category, count]) => `${category}=${count}`)
        .join(" | ");

      warnings.push(
        `Deduplicação de ingestão removeu ${dedupedMatchesFinal.removed} jogo(s) repetido(s) antes de persistir.`,
      );
      if (droppedTop) {
        warnings.push(`Deduplicação de ingestão top categorias removidas: ${droppedTop}.`);
      }
      updated.matches_deduplicated_input =
        (updated.matches_deduplicated_input ?? 0) + dedupedMatchesFinal.removed;
    }

    if (dedupedMatchesFinal.droppedMatchKeys.length > 0) {
      const staleMatches = await prisma.match.findMany({
        where: {
          eventId,
          matchKey: {
            in: dedupedMatchesFinal.droppedMatchKeys,
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

    const shouldPruneStage3StaleMatchesNow = shouldPruneStage3StaleMatches({
      pruneEnabled: config.stage3PruneStaleMatches,
      processRegistrations,
      eventConcluded: Boolean(event?.concluido),
    });
    if (shouldPruneStage3StaleMatchesNow) {
      const keepMatchKeys = new Set(dedupedMatchesFinal.matches.map((item) => item.matchKey));
      const touchedCategoryIds = new Set<number>();
      for (const item of dedupedMatchesFinal.matches) {
        const byCbtmId = item.categoryId ? categoriesByCbtmId.get(item.categoryId) ?? null : null;
        if (byCbtmId) {
          touchedCategoryIds.add(byCbtmId.id);
          continue;
        }
        const byName = categoriesByNormalized.get(item.categoryNormalizedName) ?? null;
        if (byName) {
          touchedCategoryIds.add(byName.id);
        }
      }

      if (touchedCategoryIds.size === 0) {
        warnings.push(
          "Saneamento stage-3 ignorado neste run: nenhuma categoria de confronto foi identificada no snapshot.",
        );
      }

      const existingStage3Matches = await prisma.match.findMany({
        where: {
          eventId,
          phase: {
            in: [MatchPhase.GRUPOS, MatchPhase.RESULTADOS],
          },
          ...(touchedCategoryIds.size > 0
            ? {
                categoryId: {
                  in: [...touchedCategoryIds],
                },
              }
            : {}),
        },
        select: {
          id: true,
          matchKey: true,
        },
      });
      const staleIds = existingStage3Matches
        .filter((item) => !keepMatchKeys.has(item.matchKey))
        .map((item) => item.id);
      if (staleIds.length > 0) {
        await prisma.matchParticipant.deleteMany({
          where: {
            matchId: {
              in: staleIds,
            },
          },
        });
        const deleted = await prisma.match.deleteMany({
          where: {
            id: {
              in: staleIds,
            },
          },
        });
        if (deleted.count > 0) {
          updated.matches_removed_stale_stage3 =
            (updated.matches_removed_stale_stage3 ?? 0) + deleted.count;
          warnings.push(
            `Saneamento stage-3 removeu ${deleted.count} jogo(s) obsoleto(s) fora do snapshot atual.`,
          );
        }
      }
    } else if (!processRegistrations && eventSituation === "POS_EVENTO") {
      warnings.push(
        Boolean(event?.concluido)
          ? "Saneamento stage-3 de jogos obsoletos desativado (STAGE3_PRUNE_STALE_MATCHES=false)."
          : "Saneamento stage-3 de jogos obsoletos adiado: evento ainda nao foi concluido no banco.",
      );
    }

    for (const parsedMatch of dedupedMatchesFinal.matches) {
      let reconciledCategoryId: string | null = parsedMatch.categoryId ?? null;
      const knownByCbtmId = reconciledCategoryId ? categoriesByCbtmId.get(reconciledCategoryId) ?? null : null;
      const knownByName = categoriesByNormalized.get(parsedMatch.categoryNormalizedName) ?? null;
      if (
        knownByCbtmId &&
        knownByName &&
        knownByCbtmId.id !== knownByName.id &&
        knownByName.cbtmCategoryId
      ) {
        warnings.push(
          `Reconciliacao categoria por nome aplicada no match ${parsedMatch.matchKey}: cbtmId=${reconciledCategoryId} -> ${knownByName.cbtmCategoryId} (${knownByName.name}).`,
        );
        reconciledCategoryId = knownByName.cbtmCategoryId;
      }

      const category = await this.ensureCategory(
        eventId,
        parsedMatch.categoryName,
        parsedMatch.categoryNormalizedName,
        reconciledCategoryId,
        processRegistrations,
        categoriesByNormalized,
        categoriesByCbtmId,
        inserted,
        updated,
      );
      const categoryAthletePool = getCategoryAthletePool({
        category,
        athleteIdsByCategoryId,
        athleteIdsByCategoryCbtmId,
        athleteIdsByCategoryNormalizedName,
      });
      if (!categoryAthletePool || categoryAthletePool.size === 0) {
        const categoryLabel = compactWhitespace(
          `${parsedMatch.categoryName} (${category.cbtmCategoryId ?? category.id})`,
        );
        emptyResolverPoolByCategory.set(
          categoryLabel,
          (emptyResolverPoolByCategory.get(categoryLabel) ?? 0) + 1,
        );
      }

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
        clubsByNormalized,
        athletesById,
        aliasToAthleteIds,
        conflictsByKey,
        categoryAthleteIds: categoryAthletePool,
        categoryAliasHistoryCounts:
          categoryAliasHistoryCounts.get(`${category.id}|${normalizeText(parsedMatch.athleteAName)}`) ?? null,
        autoCreateWarningAthlete: allowAutoCreateWarningAthlete,
        globalAliasHintsByAlias,
      });
      activeConflictContexts.add(`${parsedMatch.matchKey}:A`);

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
        clubsByNormalized,
        athletesById,
        aliasToAthleteIds,
        conflictsByKey,
        categoryAthleteIds: categoryAthletePool,
        categoryAliasHistoryCounts:
          categoryAliasHistoryCounts.get(`${category.id}|${normalizeText(parsedMatch.athleteBName)}`) ?? null,
        autoCreateWarningAthlete: allowAutoCreateWarningAthlete,
        globalAliasHintsByAlias,
      });
      activeConflictContexts.add(`${parsedMatch.matchKey}:B`);

      let existingMatch = await prisma.match.findUnique({
        where: { matchKey: parsedMatch.matchKey },
        select: {
          id: true,
          eventId: true,
          categoryId: true,
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
      if (!existingMatch && parsedMatch.matchKey.includes("|")) {
        const legacyMatchKey = parsedMatch.matchKey.split("|").slice(1).join("|");
        if (legacyMatchKey) {
          const legacyMatch = await prisma.match.findUnique({
            where: { matchKey: legacyMatchKey },
            select: {
              id: true,
              eventId: true,
              categoryId: true,
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
          if (
            legacyMatch &&
            legacyMatch.eventId === eventId &&
            legacyMatch.categoryId === category.id
          ) {
            await prisma.match.update({
              where: { id: legacyMatch.id },
              data: { matchKey: parsedMatch.matchKey },
            });
            existingMatch = {
              ...legacyMatch,
            };
            inc(updated, "matches_key_scoped_migrated");
          }
        }
      }

      if (!existingMatch) {
        const normalizedCbtmMatchId = extractCbtmMatchId(parsedMatch);
        if (normalizedCbtmMatchId) {
          const cbtmMatchCandidates = await prisma.match.findMany({
            where: {
              eventId,
              categoryId: category.id,
              cbtmMatchId: normalizedCbtmMatchId,
            },
            select: {
              id: true,
              eventId: true,
              categoryId: true,
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
          if (cbtmMatchCandidates.length === 1) {
            existingMatch = cbtmMatchCandidates[0];
          }
        }
      }

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

      const persistedPhase: MatchPhase = parsedMatch.phase as MatchPhase;

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
        eliminatoria: false,
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

      if (persistedPhase === "RESULTADOS" && setsResult && scoreSets.length === 0) {
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
              phase: persistedPhase,
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
              phase: persistedPhase,
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
        const categoryAthleteBucketA = athleteIdsByCategoryId.get(category.id) ?? new Set<number>();
        categoryAthleteBucketA.add(athleteA.id);
        athleteIdsByCategoryId.set(category.id, categoryAthleteBucketA);
      }

      if (athleteB) {
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

    if (emptyResolverPoolByCategory.size > 0) {
      const topCategories = [...emptyResolverPoolByCategory.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([label, count]) => `${label}=${count}`)
        .join(" | ");
      warnings.push(
        `POOL_CANDIDATOS_VAZIO_POR_CATEGORIA: ${emptyResolverPoolByCategory.size} categoria(s) sem base de atletas para resolver conflitos de jogos. Top10: ${topCategories}.`,
      );
      updated.athlete_conflicts_empty_candidate_pool =
        (updated.athlete_conflicts_empty_candidate_pool ?? 0) +
        [...emptyResolverPoolByCategory.values()].reduce((sum, count) => sum + count, 0);
    }

    await this.cleanupNonRealAthleteRecords({
      eventId,
      athletesById,
      aliasToAthleteIds,
      updated,
    });
    await this.cleanupStaleMatchConflicts({
      eventId,
      activeContexts: activeConflictContexts,
      conflictsByKey,
      updated,
      warnings,
    });

    await this.syncStableEventAthleteLinks({
      eventId,
      updated,
      warnings,
    });

    return {
      inserted,
      updated,
      warnings,
      extractionStats: {
        ...dataset.extractionStats,
        ...(registrationSyncStats ? { registrationSync: registrationSyncStats } : {}),
      },
    };
  }

  private async syncStableEventAthleteLinks(input: {
    eventId: number;
    updated: Record<string, number>;
    warnings: string[];
  }): Promise<void> {
    const eventAthleteLinks = (prisma as unknown as { eventAthleteLink: any }).eventAthleteLink;
    const athletes = await prisma.athlete.findMany({
      where: {
        eventId: input.eventId,
        createdFromWarning: false,
      },
      select: {
        id: true,
        nameDisplay: true,
        nameNormalized: true,
        club: {
          select: {
            normalizedName: true,
          },
        },
      },
    });

    const seenKeys = new Map<string, number>();
    const activeAthleteIds: number[] = [];

    for (const athlete of athletes) {
      const athleteKey = buildEventAthleteLinkKey(
        athlete.nameNormalized,
        athlete.club?.normalizedName ?? null,
      );
      const duplicateOwner = seenKeys.get(athleteKey);
      if (typeof duplicateOwner === "number" && duplicateOwner !== athlete.id) {
        input.warnings.push(
          `Link estavel duplicado detectado no evento ${input.eventId} para chave '${athleteKey}' (#${duplicateOwner} e #${athlete.id}).`,
        );
      }
      seenKeys.set(athleteKey, athlete.id);
      activeAthleteIds.push(athlete.id);

      await eventAthleteLinks.upsert({
        where: {
          eventId_athleteKey: {
            eventId: input.eventId,
            athleteKey,
          },
        },
        create: {
          eventId: input.eventId,
          athleteId: athlete.id,
          athleteKey,
          athleteName: athlete.nameDisplay,
        },
        update: {
          athleteId: athlete.id,
          athleteName: athlete.nameDisplay,
        },
      });
      inc(input.updated, "event_athlete_links_synced");
    }

    const unbound = await eventAthleteLinks.updateMany({
      where: {
        eventId: input.eventId,
        athleteId:
          activeAthleteIds.length > 0
            ? { notIn: activeAthleteIds }
            : { not: null },
      },
      data: {
        athleteId: null,
      },
    });

    if (unbound.count > 0) {
      input.updated.event_athlete_links_unbound =
        (input.updated.event_athlete_links_unbound ?? 0) + unbound.count;
    }
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
    observedRegistrationPairs: Map<string, ObservedRegistrationPair>;
    authoritativeRegistrationAbsence: boolean;
    observedRegistrationCategoryIds: Set<string>;
    observedRegistrationCategoryNames: Set<string>;
    updated: Record<string, number>;
    warnings: string[];
  }): Promise<RegistrationSyncExtractionStats> {
    const extractionStats: RegistrationSyncExtractionStats = {
      categoryHashes: {},
      categoryCoverage: {},
      categoryGapTotals: {},
      categoriesConfirmedForRemoval: [],
      categoriesBlockedByConfirmation: [],
      categoriesBlockedByCoverage: [],
    };

    const observedByCategory = new Map<
      number,
      {
        categoryName: string;
        observedPairKeys: Set<string>;
        hashTokens: string[];
      }
    >();
    for (const pair of input.observedRegistrationPairs.values()) {
      const bucket = observedByCategory.get(pair.categoryId) ?? {
        categoryName: pair.categoryName,
        observedPairKeys: new Set<string>(),
        hashTokens: [],
      };
      bucket.observedPairKeys.add(`${pair.athleteId}|${pair.categoryId}`);
      bucket.hashTokens.push(`${pair.athleteId}:${pair.registrationStatus ?? "NULL"}`);
      observedByCategory.set(pair.categoryId, bucket);
    }

    for (const [categoryId, observed] of observedByCategory.entries()) {
      const categoryKey = String(categoryId);
      extractionStats.categoryHashes[categoryKey] = this.computeRegistrationCategoryHash(observed.hashTokens);
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
      return extractionStats;
    }

    const existingTotalByCategory = new Map<number, number>();
    for (const row of existing) {
      existingTotalByCategory.set(row.categoryId, (existingTotalByCategory.get(row.categoryId) ?? 0) + 1);
    }

    const protectedCategoryIds = new Set<number>(
      existing
        .filter((row) => row.category.cbtmCategoryId && IGNORED_CATEGORY_IDS.has(row.category.cbtmCategoryId))
        .map((row) => row.categoryId),
    );

    const currentPairsByCategory = new Map<
      number,
      Array<{
        athleteId: number;
        categoryId: number;
        registrationStatus: RegistrationStatus | null;
        athleteName: string;
        categoryName: string;
        categoryNormalizedName: string;
        cbtmCategoryId: string | null;
      }>
    >();
    for (const row of existing) {
      if (protectedCategoryIds.has(row.categoryId)) {
        continue;
      }

      const bucket = currentPairsByCategory.get(row.categoryId) ?? [];
      bucket.push({
        athleteId: row.athleteId,
        categoryId: row.categoryId,
        registrationStatus: row.registrationStatus,
        athleteName: row.athlete.nameDisplay,
        categoryName: row.category.name,
        categoryNormalizedName: normalizeText(row.category.name),
        cbtmCategoryId: row.category.cbtmCategoryId,
      });
      currentPairsByCategory.set(row.categoryId, bucket);
    }

    for (const [categoryId, observed] of observedByCategory.entries()) {
      const categoryKey = String(categoryId);
      const existingTotal = existingTotalByCategory.get(categoryId) ?? 0;
      const observedTotal = observed.observedPairKeys.size;
      extractionStats.categoryGapTotals[categoryKey] = existingTotal - observedTotal;
      const existingMutableCount = currentPairsByCategory.get(categoryId)?.length ?? 0;
      extractionStats.categoryCoverage[categoryKey] =
        existingMutableCount === 0 ? 1 : observedTotal / existingMutableCount;
    }

    const previousCategoryHashes = await this.loadPreviousRegistrationSyncCategoryHashes(input.eventId);
    const categoryRemovalsAllowed = new Map<number, { categoryName: string; removableKeys: Set<string> }>();
    const emptyCategoryHash = this.computeRegistrationCategoryHash([]);

    for (const [categoryId, currentPairs] of currentPairsByCategory.entries()) {
      const observed = observedByCategory.get(categoryId);
      if (!observed) {
        const categoryKey = String(categoryId);
        const categoryName = currentPairs[0]?.categoryName ?? `categoria-${categoryId}`;
        const label = `${categoryName}#${categoryId}`;
        extractionStats.categoryHashes[categoryKey] = emptyCategoryHash;
        extractionStats.categoryGapTotals[categoryKey] = currentPairs.length;
        extractionStats.categoryCoverage[categoryKey] = 0;
        const currentCategoryId = compactWhitespace(currentPairs[0]?.cbtmCategoryId ?? "");
        const currentCategoryNormalizedName = normalizeText(currentPairs[0]?.categoryNormalizedName ?? categoryName);
        const authoritativeMissingCategory =
          input.authoritativeRegistrationAbsence &&
          ((currentCategoryId && !input.observedRegistrationCategoryIds.has(currentCategoryId)) ||
            (!currentCategoryId &&
              currentCategoryNormalizedName &&
              !input.observedRegistrationCategoryNames.has(currentCategoryNormalizedName)));

        if (authoritativeMissingCategory) {
          extractionStats.categoriesConfirmedForRemoval.push(label);
          categoryRemovalsAllowed.set(categoryId, {
            categoryName,
            removableKeys: new Set(currentPairs.map((pair) => `${pair.athleteId}|${pair.categoryId}`)),
          });
          input.warnings.push(
            `Sincronizacao de inscricoes confirmou ausencia oficial da categoria '${categoryName}' no evento ${input.eventId}; categoria e vinculos antigos serao removidos.`,
          );
          continue;
        }

        const mergeDetection = detectRegistrationCategoryMerge({
          missingCategoryId: categoryId,
          currentPairs: currentPairs.map((pair) => ({
            athleteId: pair.athleteId,
            categoryId: pair.categoryId,
            registrationStatus: pair.registrationStatus,
          })),
          observedPairs: input.observedRegistrationPairs.values(),
        });
        if (mergeDetection.merged) {
          extractionStats.categoriesConfirmedForRemoval.push(label);
          categoryRemovalsAllowed.set(categoryId, {
            categoryName,
            removableKeys: new Set(currentPairs.map((pair) => `${pair.athleteId}|${pair.categoryId}`)),
          });
          input.warnings.push(
            `Sincronizacao de inscricoes confirmou merge de categoria ausente '${categoryName}' no evento ${input.eventId} (atletas migrados=${mergeDetection.migratedAthleteCount}/${mergeDetection.totalAthleteCount}, destinos=${mergeDetection.targetCategoryIds.join(",") || "desconhecido"}).`,
          );
          continue;
        }

        const cancellationDetection = detectRegistrationCategoryCancellation({
          missingCategoryId: categoryId,
          currentPairs: currentPairs.map((pair) => ({
            athleteId: pair.athleteId,
            categoryId: pair.categoryId,
            registrationStatus: pair.registrationStatus,
          })),
          observedPairs: input.observedRegistrationPairs.values(),
          maxEntrants: config.registrationCancelledCategoryMaxEntrants,
        });
        const cancellationCandidate = cancellationDetection.cancelled;

        const previous = previousCategoryHashes.get(categoryKey);
        if (!previous || previous.hash !== emptyCategoryHash || previous.coverage !== 0) {
          extractionStats.categoriesBlockedByConfirmation.push(label);
          input.updated.registration_sync_skipped_confirmation =
            (input.updated.registration_sync_skipped_confirmation ?? 0) + currentPairs.length;
          input.warnings.push(
            cancellationCandidate
              ? `Sincronizacao de inscricoes aguardando 2 runs consecutivos para confirmar cancelamento da categoria '${categoryName}' no evento ${input.eventId} (inscritos=${cancellationDetection.totalAthleteCount}, remocoes pendentes=${currentPairs.length}).`
              : `Sincronizacao de inscricoes aguardando 2 runs consecutivos para categoria ausente '${categoryName}' no evento ${input.eventId} (remocoes pendentes=${currentPairs.length}).`,
          );
          continue;
        }

        extractionStats.categoriesConfirmedForRemoval.push(label);
        categoryRemovalsAllowed.set(categoryId, {
          categoryName,
          removableKeys: new Set(currentPairs.map((pair) => `${pair.athleteId}|${pair.categoryId}`)),
        });
        if (cancellationCandidate) {
          input.warnings.push(
            `Sincronizacao de inscricoes confirmou cancelamento da categoria '${categoryName}' no evento ${input.eventId} por insuficiencia de inscritos (inscritos=${cancellationDetection.totalAthleteCount}).`,
          );
        }
        continue;
      }

      const removablePairs = computeEventRegistrationPairRemovals({
        currentPairs: currentPairs.map((pair) => ({
          athleteId: pair.athleteId,
          categoryId: pair.categoryId,
          registrationStatus: pair.registrationStatus,
        })),
        observedPairKeys: observed.observedPairKeys,
      });
      if (removablePairs.length === 0) {
        continue;
      }

      const categoryKey = String(categoryId);
      const coverage = extractionStats.categoryCoverage[categoryKey] ?? 0;
      const label = `${observed.categoryName}#${categoryId}`;

      if (coverage < UpsertService.REGISTRATION_SYNC_MIN_CATEGORY_COVERAGE) {
        extractionStats.categoriesBlockedByCoverage.push(label);
        input.updated.registration_sync_skipped_guard =
          (input.updated.registration_sync_skipped_guard ?? 0) + removablePairs.length;
        input.warnings.push(
          `Sincronizacao de inscricoes bloqueou remocoes em '${observed.categoryName}' no evento ${input.eventId} por baixa cobertura (coverage=${Math.round(
            coverage * 100,
          )}%, observados=${observed.observedPairKeys.size}, atuais=${currentPairs.length}, remocoes=${removablePairs.length}).`,
        );
        continue;
      }

      if (input.authoritativeRegistrationAbsence) {
        extractionStats.categoriesConfirmedForRemoval.push(label);
        categoryRemovalsAllowed.set(categoryId, {
          categoryName: observed.categoryName,
          removableKeys: new Set(removablePairs.map((pair) => `${pair.athleteId}|${pair.categoryId}`)),
        });
        input.warnings.push(
          `Sincronizacao de inscricoes confirmou ausencia oficial de ${removablePairs.length} inscricao(oes) em '${observed.categoryName}' no evento ${input.eventId}; vinculos antigos serao removidos.`,
        );
        continue;
      }

      const previous = previousCategoryHashes.get(categoryKey);
      const currentHash = extractionStats.categoryHashes[categoryKey] ?? "";
      if (!previous || previous.hash !== currentHash || previous.coverage < UpsertService.REGISTRATION_SYNC_MIN_CATEGORY_COVERAGE) {
        extractionStats.categoriesBlockedByConfirmation.push(label);
        input.updated.registration_sync_skipped_confirmation =
          (input.updated.registration_sync_skipped_confirmation ?? 0) + removablePairs.length;
        input.warnings.push(
          `Sincronizacao de inscricoes aguardando 2 runs consecutivos para '${observed.categoryName}' no evento ${input.eventId} (remocoes pendentes=${removablePairs.length}).`,
        );
        continue;
      }

      extractionStats.categoriesConfirmedForRemoval.push(label);
      categoryRemovalsAllowed.set(categoryId, {
        categoryName: observed.categoryName,
        removableKeys: new Set(removablePairs.map((pair) => `${pair.athleteId}|${pair.categoryId}`)),
      });
    }

    if (categoryRemovalsAllowed.size === 0) {
      return extractionStats;
    }

    const existingByAthlete = new Map<number, typeof existing>();
    for (const row of existing) {
      const bucket = existingByAthlete.get(row.athleteId) ?? [];
      bucket.push(row);
      existingByAthlete.set(row.athleteId, bucket);
    }

    const removableByAthlete = new Map<number, Set<number>>();
    for (const rows of currentPairsByCategory.values()) {
      for (const row of rows) {
        const categoryGuard = categoryRemovalsAllowed.get(row.categoryId);
        if (!categoryGuard) {
          continue;
        }
        const key = `${row.athleteId}|${row.categoryId}`;
        if (!categoryGuard.removableKeys.has(key)) {
          continue;
        }

        const bucket = removableByAthlete.get(row.athleteId) ?? new Set<number>();
        bucket.add(row.categoryId);
        removableByAthlete.set(row.athleteId, bucket);
      }
    }

    if (removableByAthlete.size === 0) {
      return extractionStats;
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

    return extractionStats;
  }

  private computeRegistrationCategoryHash(tokens: string[]): string {
    return createHash("sha1")
      .update(tokens.slice().sort().join("|"))
      .digest("hex");
  }

  private async loadPreviousRegistrationSyncCategoryHashes(eventId: number): Promise<
    Map<
      string,
      {
        hash: string;
        coverage: number;
      }
    >
  > {
    const runs = await prisma.scrapeRun.findMany({
      where: { eventId },
      select: {
        extractionStats: true,
      },
      orderBy: { startedAt: "desc" },
      take: UpsertService.REGISTRATION_SYNC_PREVIOUS_RUN_LOOKBACK,
    });

    const map = new Map<string, { hash: string; coverage: number }>();
    for (const run of runs) {
      const extractionStats = (run.extractionStats ?? {}) as Prisma.JsonObject;
      const registrationSync = extractionStats.registrationSync as Prisma.JsonObject | undefined;
      if (!registrationSync) {
        continue;
      }
      const categoryHashes = registrationSync.categoryHashes as Prisma.JsonObject | undefined;
      const categoryCoverage = registrationSync.categoryCoverage as Prisma.JsonObject | undefined;
      if (!categoryHashes) {
        continue;
      }

      for (const [categoryId, hashValue] of Object.entries(categoryHashes)) {
        if (map.has(categoryId)) {
          continue;
        }
        const hash = typeof hashValue === "string" ? hashValue : "";
        if (!hash) {
          continue;
        }
        const rawCoverage = categoryCoverage?.[categoryId];
        const coverage = typeof rawCoverage === "number" ? rawCoverage : 0;
        map.set(categoryId, { hash, coverage });
      }
    }

    return map;
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

  private async sanitizeRegistrationOrphanCategories(input: {
    eventId: number;
    observedCategoryIds: Set<number>;
    updated: Record<string, number>;
    warnings: string[];
  }): Promise<void> {
    const orphanCategories = await prisma.category.findMany({
      where: {
        eventId: input.eventId,
        cbtmCategoryId: {
          notIn: [...IGNORED_CATEGORY_IDS],
          not: null,
        },
        athletes: {
          none: {},
        },
      },
      select: {
        id: true,
        name: true,
      },
    });

    const removableCategories = orphanCategories.filter(
      (category) => !input.observedCategoryIds.has(category.id),
    );
    if (removableCategories.length === 0) {
      return;
    }

    const removableCategoryIds = removableCategories.map((category) => category.id);
    const categoriesWithMatches = await prisma.match.findMany({
      where: {
        categoryId: { in: removableCategoryIds },
        eventId: input.eventId,
      },
      select: {
        categoryId: true,
      },
      distinct: ["categoryId"],
    });
    const protectedCategoryIds = new Set(categoriesWithMatches.map((row) => row.categoryId));

    if (protectedCategoryIds.size > 0) {
      input.warnings.push(
        `Sanitizacao de inscricoes preservou ${protectedCategoryIds.size} categoria(s) orfa(s) por ja possuirem partidas publicadas no evento ${input.eventId}.`,
      );
    }

    const finalRemovable = removableCategories.filter(
      (category) => !protectedCategoryIds.has(category.id),
    );
    if (finalRemovable.length === 0) {
      return;
    }

    await prisma.category.deleteMany({
      where: {
        id: {
          in: finalRemovable.map((category) => category.id),
        },
      },
    });

    input.updated.categories_removed_without_links =
      (input.updated.categories_removed_without_links ?? 0) + finalRemovable.length;
    input.warnings.push(
      `Sanitizacao de inscricoes removeu ${finalRemovable.length} categoria(s) sem vinculos e sem partidas no evento ${input.eventId}.`,
    );
  }

  private async ensureCategory(
    eventId: number,
    name: string,
    normalizedName: string,
    cbtmCategoryId: string | null,
    allowLabelUpdates: boolean,
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
      let nextCbtmCategoryId =
        data.cbtmCategoryId !== undefined ? data.cbtmCategoryId : category.cbtmCategoryId;
      if (category.cbtmCategoryId && nextCbtmCategoryId && category.cbtmCategoryId !== nextCbtmCategoryId) {
        // Once set, CBTM category id is canonical for the row.
        nextCbtmCategoryId = category.cbtmCategoryId;
        inc(updated, "categories_cbtm_id_conflict_ignored");
      }

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
        if (allowLabelUpdates && cachedById.name !== name) {
          patch.name = name;
        }
        if (
          allowLabelUpdates &&
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
        if (!allowLabelUpdates) {
          // Stage-3: sem owner conhecido por ID CBTM, preserva o owner por nome normalizado.
          inc(updated, "categories_cbtm_id_conflict_ignored");
          return cached;
        }
        inc(updated, "categories_cbtm_id_conflict_ignored");
        return cached;
      }

      return updateCategoryRecord(cached, {
        name: allowLabelUpdates ? name : undefined,
        cbtmCategoryId: cached.cbtmCategoryId ? cached.cbtmCategoryId : cbtmCategoryId,
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
      if (allowLabelUpdates && cachedCategory.name !== name) {
        patch.name = name;
      }
      if (
        allowLabelUpdates &&
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
        if (
          !allowLabelUpdates &&
          foundByNormalized.cbtmCategoryId &&
          foundByNormalized.cbtmCategoryId !== cbtmCategoryId
        ) {
          const cachedCategory: CachedCategory = {
            id: foundByNormalized.id,
            name: foundByNormalized.name,
            normalizedName: foundByNormalized.normalizedName,
            cbtmCategoryId: foundByNormalized.cbtmCategoryId,
          };
          syncCategoryCache(cachedCategory);
          inc(updated, "categories_cbtm_id_conflict_ignored");
          return cachedCategory;
        }
        if (foundByNormalized.cbtmCategoryId && foundByNormalized.cbtmCategoryId !== cbtmCategoryId) {
          const cachedCategory: CachedCategory = {
            id: foundByNormalized.id,
            name: foundByNormalized.name,
            normalizedName: foundByNormalized.normalizedName,
            cbtmCategoryId: foundByNormalized.cbtmCategoryId,
          };
          syncCategoryCache(cachedCategory);
          inc(updated, "categories_cbtm_id_conflict_ignored");
          return cachedCategory;
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
        name: allowLabelUpdates ? name : undefined,
        cbtmCategoryId: foundByNormalized.cbtmCategoryId ?? cbtmCategoryId,
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

  private async buildCategoryAliasHistoryCounts(
    eventId: number,
    athletesById: Map<number, CachedAthlete>,
  ): Promise<Map<string, Map<number, number>>> {
    const history = new Map<string, Map<number, number>>();
    const matches = await prisma.match.findMany({
      where: { eventId },
      select: {
        categoryId: true,
        participants: {
          select: {
            athleteId: true,
          },
        },
      },
    });

    for (const match of matches) {
      for (const participant of match.participants) {
        const athlete = athletesById.get(participant.athleteId);
        if (!athlete || athlete.createdFromWarning || athlete.eventId !== eventId) {
          continue;
        }

        const aliases = new Set<string>(athlete.aliases);
        const reducedAlias = toReducedAliasNormalized(athlete.nameDisplay);
        if (reducedAlias) {
          aliases.add(reducedAlias);
        }

        for (const alias of aliases) {
          if (!alias) {
            continue;
          }
          const key = `${match.categoryId}|${alias}`;
          const athleteCounts = history.get(key) ?? new Map<number, number>();
          athleteCounts.set(athlete.id, (athleteCounts.get(athlete.id) ?? 0) + 1);
          history.set(key, athleteCounts);
        }
      }
    }

    return history;
  }

  private async resolveMatchAthlete(input: ResolveMatchAthleteInput): Promise<CachedAthlete | null> {
    const shortName = compactWhitespace(input.shortName);
    const shortNameNormalized = normalizeText(shortName);
    if ((input.participantRefType ?? "REAL") !== "REAL" || isBracketReferenceToken(shortName)) {
      return null;
    }
    const context = `${input.matchKey}:${input.side}`;
    const conflictKey = conflictCacheKey(context, shortNameNormalized);
    const canBindAthlete = (athlete: CachedAthlete | null | undefined): athlete is CachedAthlete => {
      if (!athlete) {
        return false;
      }
      return athleteNameContainsAllReducedTokens(shortNameNormalized, athlete.nameDisplay);
    };

    const existingConflict = input.conflictsByKey.get(conflictKey);
    if (existingConflict?.resolvedAthleteId) {
      const resolvedAthlete = await this.getAthleteById(
        existingConflict.resolvedAthleteId,
        input.athletesById,
      );

      if (canBindAthlete(resolvedAthlete)) {
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

      await prisma.athleteMatchConflict.update({
        where: { id: existingConflict.id },
        data: {
          resolvedAthleteId: null,
          resolvedAt: null,
        },
      });
      existingConflict.resolvedAthleteId = null;
      inc(input.updated, "athlete_conflicts");
      input.warnings.push(
        `Conflito de atleta (${input.categoryName}) em ${context}: resolucao anterior foi invalidada por incompatibilidade entre nome reduzido e nome completo.`,
      );
    }

    let eventAliasHomonymAmbiguous = false;
    const resolveEventAliasHomonymCollision = (): CachedAthlete | null => {
      const aliasBucket = input.aliasToAthleteIds.get(shortNameNormalized);
      if (!aliasBucket || aliasBucket.size === 0) {
        return null;
      }

      if (aliasBucket.size === 1) {
        const athleteId = [...aliasBucket][0];
        const athlete = input.athletesById.get(athleteId);
        if (
          athlete &&
          athlete.eventId === input.eventId &&
          !athlete.createdFromWarning &&
          athleteNameContainsAllReducedTokens(shortNameNormalized, athlete.nameDisplay)
        ) {
          return athlete;
        }
      }

      const homonyms: CachedAthlete[] = [];
      for (const athleteId of aliasBucket) {
        const athlete = input.athletesById.get(athleteId);
        if (!athlete || athlete.eventId !== input.eventId || athlete.createdFromWarning) {
          continue;
        }
        if (!athleteNameContainsAllReducedTokens(shortNameNormalized, athlete.nameDisplay)) {
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

      const byHistory = resolveByCategoryHistory(narrowed, input.categoryAliasHistoryCounts);
      if (byHistory) {
        return byHistory;
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
        if (
          (athlete.aliases.has(shortNameNormalized) || reducedAlias === shortNameNormalized) &&
          athleteNameContainsAllReducedTokens(shortNameNormalized, athlete.nameDisplay)
        ) {
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

      const byHistory = resolveByCategoryHistory(narrowed, input.categoryAliasHistoryCounts);
      if (byHistory) {
        categoryAliasAmbiguous = false;
        return byHistory;
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

    let resolverCandidates = buildResolverCandidates({
      eventId: input.eventId,
      athletesById: input.athletesById,
      categoryAthleteIds: input.categoryAthleteIds,
    });

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
      if (canBindAthlete(resolvedAthlete)) {
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

    const localFallbackCandidates =
      decision.scoredCandidates.length > 0
        ? decision.scoredCandidates.slice(0, 10).map((candidate) => ({
            athleteId: candidate.athleteId,
            nameDisplay: candidate.nameDisplay,
            rankingPoints: candidate.rankingPoints,
            ratingPoints: candidate.ratingPoints,
            score: candidate.score,
            reasons: candidate.reasons,
          }))
        : this.buildFallbackConflictCandidates({
            shortNameNormalized,
            resolverCandidates,
            observedClubNormalizedName: input.clubNormalizedName,
            observedRankingPoints: input.rankingPoints,
            observedRatingPoints: input.ratingPoints,
          });
    const globalNameHints =
      localFallbackCandidates.length === 0
        ? await this.getGlobalAliasHints(shortNameNormalized, resolverCandidates, input.globalAliasHintsByAlias)
        : [];

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
      candidates: localFallbackCandidates.slice(0, 10),
      hints: globalNameHints,
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

    if (
      input.autoCreateWarningAthlete &&
      !categoryAliasAmbiguous &&
      !eventAliasHomonymAmbiguous &&
      payload.candidates.length === 0
    ) {
      const warningAthlete = await this.ensureWarningAthleteForConflict({
        eventId: input.eventId,
        categoryId: input.categoryId,
        shortName,
        shortNameNormalized,
        rankingPoints: input.rankingPoints,
        ratingPoints: input.ratingPoints,
        clubNormalizedName: input.clubNormalizedName,
        clubsByNormalized: input.clubsByNormalized,
        inserted: input.inserted,
        updated: input.updated,
        athletesById: input.athletesById,
        aliasToAthleteIds: input.aliasToAthleteIds,
      });

      const conflictToResolve = input.conflictsByKey.get(conflictKey);
      if (conflictToResolve && conflictToResolve.resolvedAthleteId !== warningAthlete.id) {
        await prisma.athleteMatchConflict.update({
          where: { id: conflictToResolve.id },
          data: {
            resolvedAthleteId: warningAthlete.id,
            resolvedAt: new Date(),
          },
        });
        conflictToResolve.resolvedAthleteId = warningAthlete.id;
        inc(input.updated, "athlete_conflicts");
      }

      input.warnings.push(
        `Conflito de atleta (${input.categoryName}) em ${context}: '${shortName}' foi vinculado automaticamente a um atleta temporario por ausencia de candidatos.`,
      );

      return warningAthlete;
    }

    input.warnings.push(
      `Conflito de atleta (${input.categoryName}) em ${context}: '${shortName}' não pôde ser resolvido automaticamente.`,
    );

    return null;
  }

  private buildFallbackConflictCandidates(input: {
    shortNameNormalized: string;
    resolverCandidates: AthleteResolverCandidate[];
    observedClubNormalizedName: string | null;
    observedRankingPoints: number | null;
    observedRatingPoints: number | null;
  }): Array<{
    athleteId: number;
    nameDisplay: string;
    rankingPoints: number | null;
    ratingPoints: number | null;
    score: number;
    reasons: string[];
  }> {
    const shortTokens = input.shortNameNormalized.split(" ").filter(Boolean);
    const first = shortTokens[0] ?? "";
    const last = shortTokens[shortTokens.length - 1] ?? "";
    const hasCompoundShortName = shortTokens.length >= 2;

    const scored = input.resolverCandidates
      .map((candidate) => {
        if (!athleteNameContainsAllReducedTokens(input.shortNameNormalized, candidate.nameDisplay)) {
          return {
            athleteId: candidate.athleteId,
            nameDisplay: candidate.nameDisplay,
            rankingPoints: candidate.rankingPoints,
            ratingPoints: candidate.ratingPoints,
            score: 0,
            reasons: [] as string[],
          };
        }
        let score = 0;
        const reasons: string[] = [];
        const candidateName = normalizeAthleteName(candidate.nameDisplay);
        const candidateTokens = candidateName.split(" ").filter(Boolean);
        const candidateFirst = candidateTokens[0] ?? "";
        const candidateLast = candidateTokens[candidateTokens.length - 1] ?? "";
        const tokenOverlapCount = shortTokens.filter((token) => candidateTokens.includes(token)).length;

        if (input.shortNameNormalized && candidateName === input.shortNameNormalized) {
          score += 80;
          reasons.push("nome exato");
        } else if (
          input.shortNameNormalized &&
          (candidateName.includes(input.shortNameNormalized) ||
            input.shortNameNormalized.includes(candidateName))
        ) {
          score += 55;
          reasons.push("nome aproximado");
        }

        if (first && candidateFirst === first) {
          score += 20;
          reasons.push("primeiro nome");
        }
        if (last && candidateLast === last) {
          score += 20;
          reasons.push("sobrenome");
        }
        if (
          input.observedClubNormalizedName &&
          candidate.clubNormalizedName === input.observedClubNormalizedName
        ) {
          score += 10;
          reasons.push("clube");
        }
        if (
          Number.isInteger(input.observedRankingPoints) &&
          candidate.rankingPoints === input.observedRankingPoints
        ) {
          score += 8;
          reasons.push("ranking");
        }
        if (
          Number.isInteger(input.observedRatingPoints) &&
          candidate.ratingPoints === input.observedRatingPoints
        ) {
          score += 8;
          reasons.push("rating");
        }

        if (tokenOverlapCount >= 2) {
          score += 12;
          reasons.push("tokens coincidentes");
        }

        if (hasCompoundShortName && last && candidateLast !== last && !candidateTokens.includes(last)) {
          score = 0;
        }

        return {
          athleteId: candidate.athleteId,
          nameDisplay: candidate.nameDisplay,
          rankingPoints: candidate.rankingPoints,
          ratingPoints: candidate.ratingPoints,
          score,
          reasons,
        };
      })
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score || a.nameDisplay.localeCompare(b.nameDisplay, "pt-BR"));

    return scored;
  }

  private async reconcileCategoriesWithSource(
    eventId: number,
    parsedCategories: ParsedDataset["categories"],
    updated: Record<string, number>,
    warnings: string[],
  ): Promise<void> {
    const sourceByCbtmId = new Map<string, { name: string; normalizedName: string }>();
    for (const parsed of parsedCategories) {
      const cbtmCategoryId = String(parsed.categoryId ?? "").trim();
      const name = compactWhitespace(parsed.categoryName);
      const normalizedName =
        normalizeText(parsed.categoryNormalizedName) || normalizeText(parsed.categoryName);
      if (!cbtmCategoryId || !name || !normalizedName) {
        continue;
      }
      if (!sourceByCbtmId.has(cbtmCategoryId)) {
        sourceByCbtmId.set(cbtmCategoryId, { name, normalizedName });
      }
    }
    if (sourceByCbtmId.size === 0) {
      return;
    }

    const desiredIds = new Set(sourceByCbtmId.keys());
    const current = await prisma.category.findMany({
      where: { eventId },
      select: {
        id: true,
        name: true,
        normalizedName: true,
        cbtmCategoryId: true,
      },
    });

    const currentById = new Map(current.map((row) => [row.id, row]));
    let detached = 0;
    let reassigned = 0;
    let refreshed = 0;
    let created = 0;

    // 1) Detach rows whose cbtm id belongs to source set but label clearly mismatches source.
    for (const row of current) {
      if (!row.cbtmCategoryId || !desiredIds.has(row.cbtmCategoryId)) {
        continue;
      }
      const expected = sourceByCbtmId.get(row.cbtmCategoryId);
      if (!expected) {
        continue;
      }
      if (
        row.normalizedName === expected.normalizedName ||
        normalizeText(row.name) === expected.normalizedName
      ) {
        continue;
      }
      await prisma.category.update({
        where: { id: row.id },
        data: { cbtmCategoryId: null },
      });
      const cached = currentById.get(row.id);
      if (cached) {
        cached.cbtmCategoryId = null;
      }
      detached += 1;
    }

    // 2) Ensure each source cbtm id has an owner aligned with source label.
    for (const [cbtmCategoryId, expected] of sourceByCbtmId.entries()) {
      const byId = [...currentById.values()].find((row) => row.cbtmCategoryId === cbtmCategoryId) ?? null;
      if (byId) {
        if (byId.name !== expected.name || byId.normalizedName !== expected.normalizedName) {
          await prisma.category.update({
            where: { id: byId.id },
            data: {
              name: expected.name,
              normalizedName: expected.normalizedName,
            },
          });
          byId.name = expected.name;
          byId.normalizedName = expected.normalizedName;
          refreshed += 1;
        }
        continue;
      }

      const candidate =
        [...currentById.values()].find(
          (row) =>
            row.normalizedName === expected.normalizedName &&
            (!row.cbtmCategoryId || !desiredIds.has(row.cbtmCategoryId)),
        ) ?? null;
      if (candidate) {
        await prisma.category.update({
          where: { id: candidate.id },
          data: {
            name: expected.name,
            normalizedName: expected.normalizedName,
            cbtmCategoryId,
          },
        });
        candidate.name = expected.name;
        candidate.normalizedName = expected.normalizedName;
        candidate.cbtmCategoryId = cbtmCategoryId;
        reassigned += 1;
        continue;
      }

      const inserted = await prisma.category.create({
        data: {
          eventId,
          name: expected.name,
          normalizedName: expected.normalizedName,
          cbtmCategoryId,
        },
        select: {
          id: true,
          name: true,
          normalizedName: true,
          cbtmCategoryId: true,
        },
      });
      currentById.set(inserted.id, inserted);
      created += 1;
    }

    if (detached + reassigned + refreshed + created > 0) {
      inc(updated, "categories_reconciled_from_source");
      warnings.push(
        `Reconciliacao de categorias (fonte oficial) no evento ${eventId}: detach=${detached}, reassigned=${reassigned}, refreshed=${refreshed}, created=${created}.`,
      );
    }
  }

  private async repairMisnormalizedCategories(
    eventId: number,
    updated: Record<string, number>,
    warnings: string[],
  ): Promise<void> {
    const categories = await prisma.category.findMany({
      where: { eventId },
      select: {
        id: true,
        name: true,
        normalizedName: true,
        cbtmCategoryId: true,
      },
    });
    if (categories.length === 0) {
      return;
    }

    const byNormalized = new Map<string, (typeof categories)[number]>();
    for (const category of categories) {
      if (!byNormalized.has(category.normalizedName)) {
        byNormalized.set(category.normalizedName, category);
      }
    }

    let normalizedFixed = 0;
    let merged = 0;
    for (const source of categories) {
      const expectedNormalized = normalizeText(source.name);
      if (!expectedNormalized || expectedNormalized === source.normalizedName) {
        continue;
      }

      const target = byNormalized.get(expectedNormalized);
      if (!target || target.id === source.id) {
        try {
          await prisma.category.update({
            where: { id: source.id },
            data: { normalizedName: expectedNormalized },
          });
          normalizedFixed += 1;
          source.normalizedName = expectedNormalized;
          byNormalized.set(expectedNormalized, source);
        } catch {
          // Ignore; likely unique collision from another category.
        }
        continue;
      }

      // Merge only when display label is the same to avoid unsafe consolidation.
      if (compactWhitespace(target.name) !== compactWhitespace(source.name)) {
        continue;
      }

      await prisma.$transaction(async (tx) => {
        const athleteIdsAtTarget = await tx.athleteCategory.findMany({
          where: { categoryId: target.id },
          select: { athleteId: true },
        });
        if (athleteIdsAtTarget.length > 0) {
          await tx.athleteCategory.deleteMany({
            where: {
              categoryId: source.id,
              athleteId: { in: athleteIdsAtTarget.map((row) => row.athleteId) },
            },
          });
        }

        await tx.athleteCategory.updateMany({
          where: { categoryId: source.id },
          data: { categoryId: target.id },
        });

        await tx.match.updateMany({
          where: {
            eventId,
            categoryId: source.id,
          },
          data: {
            categoryId: target.id,
          },
        });

        if (!target.cbtmCategoryId && source.cbtmCategoryId) {
          await tx.category.update({
            where: { id: target.id },
            data: { cbtmCategoryId: source.cbtmCategoryId },
          });
        }

        const refs = await Promise.all([
          tx.athleteCategory.count({ where: { categoryId: source.id } }),
          tx.match.count({ where: { eventId, categoryId: source.id } }),
        ]);
        if (refs[0] === 0 && refs[1] === 0) {
          await tx.category.delete({ where: { id: source.id } });
        }
      });
      merged += 1;
    }

    if (normalizedFixed > 0) {
      inc(updated, "categories_normalized_repaired");
      warnings.push(
        `Saneamento de categorias ajustou normalized_name em ${normalizedFixed} registro(s) no evento ${eventId}.`,
      );
    }
    if (merged > 0) {
      inc(updated, "categories_merged_misnormalized");
      warnings.push(
        `Saneamento de categorias consolidou ${merged} categoria(s) com nome duplicado e normalized_name inconsistente no evento ${eventId}.`,
      );
    }
  }

  private async repairEventScopedCategoryAliases(
    eventId: number,
    eventName: string | null,
    updated: Record<string, number>,
    warnings: string[],
  ): Promise<void> {
    const categories = await prisma.category.findMany({
      where: { eventId },
      select: {
        id: true,
        name: true,
        normalizedName: true,
        cbtmCategoryId: true,
      },
    });
    if (categories.length === 0) {
      return;
    }

    const byNormalized = new Map<string, (typeof categories)[number]>();
    for (const category of categories) {
      if (!byNormalized.has(category.normalizedName)) {
        byNormalized.set(category.normalizedName, category);
      }
    }

    let renamed = 0;
    let merged = 0;

    for (const source of categories) {
      const expectedName = canonicalizeEventScopedCategoryName(eventName, source.name);
      const expectedNormalized = normalizeText(expectedName);
      if (!expectedName || !expectedNormalized) {
        continue;
      }
      if (source.name === expectedName && source.normalizedName === expectedNormalized) {
        continue;
      }

      const target = byNormalized.get(expectedNormalized) ?? null;
      if (!target || target.id === source.id) {
        await prisma.category.update({
          where: { id: source.id },
          data: {
            name: expectedName,
            normalizedName: expectedNormalized,
          },
        });
        source.name = expectedName;
        source.normalizedName = expectedNormalized;
        byNormalized.set(expectedNormalized, source);
        renamed += 1;
        continue;
      }

      await prisma.$transaction(async (tx) => {
        const athleteIdsAtTarget = await tx.athleteCategory.findMany({
          where: { categoryId: target.id },
          select: { athleteId: true },
        });
        if (athleteIdsAtTarget.length > 0) {
          await tx.athleteCategory.deleteMany({
            where: {
              categoryId: source.id,
              athleteId: { in: athleteIdsAtTarget.map((row) => row.athleteId) },
            },
          });
        }

        await tx.athleteCategory.updateMany({
          where: { categoryId: source.id },
          data: { categoryId: target.id },
        });

        await tx.match.updateMany({
          where: {
            eventId,
            categoryId: source.id,
          },
          data: {
            categoryId: target.id,
          },
        });

        if (!target.cbtmCategoryId && source.cbtmCategoryId) {
          await tx.category.update({
            where: { id: target.id },
            data: { cbtmCategoryId: source.cbtmCategoryId },
          });
        }

        const refs = await Promise.all([
          tx.athleteCategory.count({ where: { categoryId: source.id } }),
          tx.match.count({ where: { eventId, categoryId: source.id } }),
        ]);
        if (refs[0] === 0 && refs[1] === 0) {
          await tx.category.delete({ where: { id: source.id } });
        }
      });

      merged += 1;
    }

    if (renamed > 0) {
      inc(updated, "categories_alias_renamed");
      warnings.push(
        `Saneamento de aliases de categoria renomeou ${renamed} registro(s) no evento ${eventId}.`,
      );
    }
    if (merged > 0) {
      inc(updated, "categories_alias_merged");
      warnings.push(
        `Saneamento de aliases de categoria consolidou ${merged} categoria(s) no evento ${eventId}.`,
      );
    }
  }

  private async getGlobalAliasHints(
    shortNameNormalized: string,
    resolverCandidates: AthleteResolverCandidate[],
    cache: Map<string, string[]>,
  ): Promise<string[]> {
    if (!shortNameNormalized) {
      return [];
    }

    const cached = cache.get(shortNameNormalized);
    if (cached) {
      return cached;
    }

    const localNames = new Set(
      resolverCandidates.map((candidate) => normalizeAthleteName(candidate.nameDisplay)).filter(Boolean),
    );

    const rows = await prisma.athleteAlias.findMany({
      where: {
        aliasNormalized: shortNameNormalized,
      },
      select: {
        athlete: {
          select: {
            nameDisplay: true,
            createdFromWarning: true,
          },
        },
      },
      take: 30,
      orderBy: [{ createdAt: "desc" }],
    });

    const hints = [...new Set(
      rows
        .map((row) => compactWhitespace(row.athlete.nameDisplay))
        .filter(Boolean)
        .filter((name) => athleteNameContainsAllReducedTokens(shortNameNormalized, name))
        .filter((name) => !localNames.has(normalizeAthleteName(name)))
        .slice(0, 5),
    )];

    cache.set(shortNameNormalized, hints);
    return hints;
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

  private async ensureWarningAthleteForConflict(input: {
    eventId: number;
    categoryId: number;
    shortName: string;
    shortNameNormalized: string;
    rankingPoints: number | null;
    ratingPoints: number | null;
    clubNormalizedName: string | null;
    clubsByNormalized: Map<string, CachedClub>;
    inserted: Record<string, number>;
    updated: Record<string, number>;
    athletesById: Map<number, CachedAthlete>;
    aliasToAthleteIds: Map<string, Set<number>>;
  }): Promise<CachedAthlete> {
    const clubNameDisplay = compactWhitespace(input.clubNormalizedName ?? "") || "SEM CLUBE";
    const clubNameNormalized = normalizeText(clubNameDisplay) || "sem clube";
    const club = await this.ensureClub(
      clubNameDisplay,
      clubNameNormalized,
      input.clubsByNormalized,
      input.inserted,
      input.updated,
    );

    const warningNameNormalized = `${input.shortNameNormalized}__autowarn_c${input.categoryId}`;

    let athleteRecord = await prisma.athlete.findUnique({
      where: {
        eventId_nameNormalized_clubId: {
          eventId: input.eventId,
          nameNormalized: warningNameNormalized,
          clubId: club.id,
        },
      },
      include: {
        club: true,
        aliases: true,
      },
    });

    if (!athleteRecord) {
      athleteRecord = await prisma.athlete.create({
        data: {
          eventId: input.eventId,
          clubId: club.id,
          nameDisplay: input.shortName,
          nameNormalized: warningNameNormalized,
          rankingPoints: input.rankingPoints,
          ratingPoints: input.ratingPoints,
          createdFromWarning: true,
        },
        include: {
          club: true,
          aliases: true,
        },
      });
      inc(input.inserted, "athletes");
    }

    const cachedAthlete: CachedAthlete = {
      id: athleteRecord.id,
      eventId: athleteRecord.eventId,
      clubId: athleteRecord.clubId,
      clubNormalizedName: athleteRecord.club?.normalizedName ?? club.normalizedName,
      stateCode: athleteRecord.stateCode,
      stateName: athleteRecord.stateName,
      region: athleteRecord.region,
      nameDisplay: athleteRecord.nameDisplay,
      nameNormalized: athleteRecord.nameNormalized,
      rankingPoints: athleteRecord.rankingPoints,
      ratingPoints: athleteRecord.ratingPoints,
      createdFromWarning: athleteRecord.createdFromWarning,
      aliases: new Set<string>([
        athleteRecord.nameNormalized,
        ...athleteRecord.aliases.map((alias) => alias.aliasNormalized),
      ]),
    };

    input.athletesById.set(cachedAthlete.id, cachedAthlete);
    this.indexAlias(input.aliasToAthleteIds, cachedAthlete.nameNormalized, cachedAthlete.id);

    await this.reconcileAthletePoints(
      cachedAthlete,
      input.rankingPoints,
      input.ratingPoints,
      input.updated,
    );

    await this.ensureAthleteAlias({
      athleteId: cachedAthlete.id,
      aliasDisplay: input.shortName,
      aliasNormalized: input.shortNameNormalized,
      source: "JOGOS",
      inserted: input.inserted,
      updated: input.updated,
      athletesById: input.athletesById,
      aliasToAthleteIds: input.aliasToAthleteIds,
    });

    return cachedAthlete;
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

  private async cleanupStaleMatchConflicts(input: {
    eventId: number;
    activeContexts: Set<string>;
    conflictsByKey: Map<string, CachedConflict>;
    updated: Record<string, number>;
    warnings: string[];
  }): Promise<void> {
    if (input.activeContexts.size === 0) {
      return;
    }

    const activeContextList = [...input.activeContexts];
    const stale = await prisma.athleteMatchConflict.findMany({
      where: {
        eventId: input.eventId,
        context: {
          notIn: activeContextList,
        },
      },
      select: {
        id: true,
        context: true,
        shortNameNormalized: true,
      },
    });

    if (stale.length === 0) {
      return;
    }

    await prisma.athleteMatchConflict.deleteMany({
      where: {
        id: {
          in: stale.map((item) => item.id),
        },
      },
    });

    for (const item of stale) {
      input.conflictsByKey.delete(conflictCacheKey(item.context, item.shortNameNormalized));
    }

    input.updated.athlete_conflicts_removed_stale =
      (input.updated.athlete_conflicts_removed_stale ?? 0) + stale.length;
    input.warnings.push(
      `Limpeza de conflitos removeu ${stale.length} conflito(s) obsoleto(s) sem contexto ativo de jogo no evento ${input.eventId}.`,
    );
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




