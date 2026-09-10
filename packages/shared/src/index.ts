import { createHash } from "crypto";
export * from "./event-situation";
export * from "./brazil-states";
export * from "./registration-status";

export const OPERATIONAL_WARNING_CODES = new Set<string>([
  "POST_SCRAPE_SUMMARY",
  "GUARDRAIL_REGISTRATION_DROP",
  "GUARDRAIL_REGRESSION",
  "HTTP_DEGRADED_RESULTS",
  "SCRAPE_STRICT_QUALITY_GATE_ALERTA",
  "AUDITORIA_CATEGORIAS_DIVERGENCIA",
  "AUDITORIA_INSCRICOES_DIVERGENCIA",
  "AUDITORIA_PARTIDAS_DIVERGENCIA",
  "AUDITORIA_PARTIDAS_JOGADAS_DIVERGENCIA",
  "AUDITORIA_CONFLITOS_PENDENTES",
  "AUDITORIA_ELIMINATORIA_BLOQUEADA",
  "AUDITORIA_REGRA_VINCULO",
  "CONFLITO_DE_ATLETA_PENDENTE",
  "CONFLITO_DE_ATLETA_AUTORRESOLVIDO",
  "MERGE_WARNING_PARTICIPANTES",
  "WARNINGS_FILTRADOS_RUIDO",
  "WARNINGS_SEVERIDADE_TRUNCADOS",
  "WARNINGS_TRUNCATED",
]);

export function extractWarningCode(warning: string | null | undefined): string | null {
  const text = String(warning ?? "").trim();
  if (!text) {
    return null;
  }
  const match = text.match(/^([A-Z0-9_]+):/);
  return match?.[1] ?? null;
}

export function isOperationalRecoveryWarning(warning: string | null | undefined): boolean {
  const code = extractWarningCode(warning);
  if (!code) {
    return false;
  }
  return OPERATIONAL_WARNING_CODES.has(code);
}

export type MatchPhase = "INSCRICOES" | "GRUPOS" | "RESULTADOS" | "ELIMINATORIA";
export type AliasSource = "INSCRICOES" | "JOGOS";
export type SummaryOrderBy = "phase_hierarchy_datetime" | "category_phase_datetime";

export interface ParsedMatchSet {
  p1: number;
  p2: number;
}

export interface ParsedMatchSetsResult {
  p1Sets: number;
  p2Sets: number;
}

export interface MatchKeyInput {
  eventId: number;
  categoryNormalized: string;
  phase: MatchPhase;
  round?: string | null;
  tableNumber?: string | null;
  matchDatetime?: string | null;
  athleteA: string;
  athleteB: string;
}

export interface ParsedRegistration {
  categoryId?: string | null;
  athleteName: string;
  athleteNormalizedName: string;
  clubName: string;
  clubNormalizedName: string;
  categoryName: string;
  categoryNormalizedName: string;
  status: string;
  rankingPoints: number | null;
  ratingPoints: number | null;
}

export interface ParsedMatch {
  athleteARefType?: "REAL" | "GROUP_SLOT" | "WINNER_SLOT";
  athleteBRefType?: "REAL" | "GROUP_SLOT" | "WINNER_SLOT";
  categoryId?: string | null;
  phase: MatchPhase;
  categoryName: string;
  categoryNormalizedName: string;
  cbtmMatchId?: string | null;
  round: string | null;
  tableNumber: string | null;
  matchDatetime: string | null;
  scoreRaw: string;
  athleteAName: string;
  athleteANormalizedName: string;
  athleteBName: string;
  athleteBNormalizedName: string;
  athleteARankingPoints?: number | null;
  athleteARatingPoints?: number | null;
  athleteBRankingPoints?: number | null;
  athleteBRatingPoints?: number | null;
  athleteAClubNormalizedName?: string | null;
  athleteBClubNormalizedName?: string | null;
  matchKey: string;
  sets?: ParsedMatchSet[];
  setsResult?: ParsedMatchSetsResult | null;
  winnerIndex?: 0 | 1 | null;
  sourceUrl?: string | null;
  sourceFlags?: {
    resultados?: boolean;
    eliminatoria?: boolean;
  } | null;
  metadata?: Record<string, string | number | null>;
}

export interface ParsedCategory {
  categoryId: string | null;
  categoryName: string;
  categoryNormalizedName: string;
  valid: boolean;
  source: "SCRAPER" | "INSCRICOES" | "MATCHES";
}

export interface ParsedDataset {
  categories: ParsedCategory[];
  registrations: ParsedRegistration[];
  matches: ParsedMatch[];
  warnings: string[];
  extractionStats: {
    totalCategoriesFound: number;
    totalCategoriesValid: number;
    categoriesScanned: number;
    tabPayloadCounts: Record<string, number>;
    tabItemCounts: Record<string, number>;
    categoryTabPayloadCounts: Record<string, Record<string, number>>;
    registrationsByCategory: Record<string, number>;
    matchesByCategoryPhase: Record<string, Record<string, number>>;
    uniqueAthletesConsolidated: number;
  };
}

export interface AthleteResolverCandidate {
  athleteId: number;
  eventId: number;
  nameDisplay: string;
  nameNormalized: string;
  rankingPoints: number | null;
  ratingPoints: number | null;
  clubNormalizedName: string | null;
  aliasesNormalized: string[];
}

export interface AthleteResolutionInput {
  eventId: number;
  shortName: string;
  shortNameNormalized?: string;
  rankingPoints?: number | null;
  ratingPoints?: number | null;
  clubNormalizedName?: string | null;
  candidates: AthleteResolverCandidate[];
}

export interface AthleteResolutionCandidateScore {
  athleteId: number;
  nameDisplay: string;
  rankingPoints: number | null;
  ratingPoints: number | null;
  score: number;
  reasons: string[];
}

export interface AthleteResolutionResult {
  status: "resolved" | "conflict";
  strategy: "alias-exato" | "forte-ranking-rating" | "heuristica";
  athleteId?: number;
  score?: number;
  reasons?: string[];
  scoredCandidates: AthleteResolutionCandidateScore[];
}

export interface MatchPerformancePlayer {
  athleteId?: number | null;
  name?: string | null;
}

export interface MatchPerformanceInput {
  players: [MatchPerformancePlayer, MatchPerformancePlayer] | MatchPerformancePlayer[];
  sets: Array<{ p1: number | null | undefined; p2: number | null | undefined }>;
  winnerIndex?: 0 | 1 | null;
}

export interface AthletePerformanceInput {
  athleteId?: number | null;
  athleteIds?: number[];
  athleteName?: string | null;
  athleteNameNormalized?: string | null;
}

export interface AthletePointPerformance {
  pointsWon: number;
  pointsPlayed: number;
  ratio: number | null;
  setsUsed: number;
  ignoredSets: number;
  matchesConsidered: number;
}

export interface OfficialCategoryMatchesOptions {
  categoryName?: string | null;
  eventStartDate?: Date | string | null;
  ratingMatchFormat?: "RR_K1" | "K1" | null;
  competitionFormat?: "AUTO" | "K1" | null;
}

export interface WalkoverDetectionInput {
  sets?: Array<{ p1: number | null | undefined; p2: number | null | undefined }> | null;
  p1Sets?: number | null;
  p2Sets?: number | null;
  scoreRaw?: string | null;
}

export interface WalkoverDetectionResult {
  isWalkover: boolean;
  isDoubleWalkover: boolean;
}

const RATING_SIMPLE_ELIMINATION_EFFECTIVE_DATE = "2026-02-24";

function isRatingCategoryName(categoryName: string | null | undefined): boolean {
  const normalized = normalizeText(String(categoryName ?? ""))
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
  return /^R[A-Z]/.test(normalized);
}

function isOnOrAfterEffectiveDate(dateValue: Date | string | null | undefined): boolean {
  if (!dateValue) {
    return false;
  }
  const date = dateValue instanceof Date ? dateValue : new Date(String(dateValue));
  if (Number.isNaN(date.getTime())) {
    return false;
  }
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const isoDate = `${yyyy}-${mm}-${dd}`;
  return isoDate >= RATING_SIMPLE_ELIMINATION_EFFECTIVE_DATE;
}

function normalizeInteger(value: number | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (!Number.isFinite(Number(value))) {
    return null;
  }
  return Math.trunc(Number(value));
}

function normalizeScoreRaw(value: string | null | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, "");
}

function normalizeSets(
  sets: Array<{ p1: number | null | undefined; p2: number | null | undefined }> | null | undefined,
): Array<{ p1: number; p2: number }> {
  if (!Array.isArray(sets)) {
    return [];
  }
  const out: Array<{ p1: number; p2: number }> = [];
  for (const set of sets) {
    const p1 = normalizeInteger(set?.p1 ?? null);
    const p2 = normalizeInteger(set?.p2 ?? null);
    if (p1 === null || p2 === null) {
      continue;
    }
    out.push({ p1, p2 });
  }
  return out;
}

export function detectWalkover(input: WalkoverDetectionInput): WalkoverDetectionResult {
  const scoreRaw = normalizeScoreRaw(input.scoreRaw);
  const p1Sets = normalizeInteger(input.p1Sets ?? null);
  const p2Sets = normalizeInteger(input.p2Sets ?? null);
  const sets = normalizeSets(input.sets ?? []);

  if (scoreRaw.includes("wo")) {
    return { isWalkover: true, isDoubleWalkover: false };
  }

  const allZeroSets = sets.length > 0 && sets.every((set) => set.p1 === 0 && set.p2 === 0);
  if (allZeroSets) {
    const explicitZeroFinal =
      (p1Sets === 0 && p2Sets === 0) || scoreRaw.includes("0x0") || scoreRaw.includes("0-0");
    if (explicitZeroFinal) {
      return { isWalkover: true, isDoubleWalkover: true };
    }
    return { isWalkover: false, isDoubleWalkover: false };
  }

  if (sets.length === 3) {
    const p1Straight = sets.every((set) => set.p1 === 11 && set.p2 === 0);
    const p2Straight = sets.every((set) => set.p2 === 11 && set.p1 === 0);
    if (p1Straight || p2Straight) {
      const matchesResult =
        (p1Straight && (p1Sets === null || p2Sets === null || (p1Sets === 3 && p2Sets === 0))) ||
        (p2Straight && (p1Sets === null || p2Sets === null || (p1Sets === 0 && p2Sets === 3)));
      if (matchesResult) {
        return { isWalkover: true, isDoubleWalkover: false };
      }
    }
  }

  return { isWalkover: false, isDoubleWalkover: false };
}

export function computeOfficialCategoryMatchesCount(
  registeredCount: number | null | undefined,
  options?: OfficialCategoryMatchesOptions,
): number {
  const n = Number(registeredCount ?? 0);
  if (!Number.isFinite(n) || n <= 1) {
    return 0;
  }

  if (options?.competitionFormat === "K1") {
    return n - 1;
  }

  if (isRatingCategoryName(options?.categoryName)) {
    if (options?.ratingMatchFormat === "K1") {
      return n - 1;
    }
    if (
      options?.ratingMatchFormat !== "RR_K1" &&
      isOnOrAfterEffectiveDate(options?.eventStartDate)
    ) {
      return n - 1;
    }
  }

  if (n <= 5) {
    return (n * (n - 1)) / 2;
  }

  // Acima de 5 atletas: grupos de 3, com excedentes distribuídos nos dois últimos grupos (até 4 atletas).
  // Classificam 2 por grupo e a fase final é eliminatória simples.
  const groupCount = Math.floor(n / 3);
  if (groupCount <= 0) {
    return 0;
  }

  const remainder = n % 3;
  const groupSizes = Array.from({ length: groupCount }, () => 3);
  for (let index = 0; index < remainder; index += 1) {
    const target = groupCount - 1 - index;
    if (target >= 0) {
      groupSizes[target] += 1;
    }
  }

  const groupMatches = groupSizes.reduce((sum, size) => sum + (size * (size - 1)) / 2, 0);
  const qualifiers = groupCount * 2;
  const eliminationMatches = qualifiers > 0 ? qualifiers - 1 : 0;
  return groupMatches + eliminationMatches;
}

function tokenizeNormalizedName(value: string): string[] {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

function normalizeAthleteAliasKey(value: string): string {
  return tokenizeNormalizedName(value).join(" ");
}

function isNearToken(a: string, b: string): boolean {
  if (!a || !b) {
    return false;
  }
  if (a === b) {
    return true;
  }
  if (Math.abs(a.length - b.length) > 1) {
    return false;
  }

  const minLen = Math.min(a.length, b.length);
  if (minLen < 5) {
    return false;
  }

  let i = 0;
  let j = 0;
  let edits = 0;

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }

    edits += 1;
    if (edits > 1) {
      return false;
    }

    if (a.length > b.length) {
      i += 1;
    } else if (b.length > a.length) {
      j += 1;
    } else {
      i += 1;
      j += 1;
    }
  }

  if (i < a.length || j < b.length) {
    edits += 1;
  }

  return edits <= 1;
}

function hasTokenCompatible(shortToken: string, fullTokens: string[]): boolean {
  return fullTokens.some((fullToken) => fullToken === shortToken || isNearToken(shortToken, fullToken));
}

function isBaseNameCompatible(shortNameNormalized: string, fullNameNormalized: string): boolean {
  const shortTokens = tokenizeNormalizedName(shortNameNormalized);
  const fullTokens = tokenizeNormalizedName(fullNameNormalized);

  if (shortTokens.length === 0 || fullTokens.length === 0) {
    return false;
  }

  // Regra preventiva para alias reduzido: exige match completo dos tokens do alias.
  // Evita falso-positivo por apenas 1 token coincidente (ex.: "ELIAS SANTOS" vs "... SANTOS").
  if (shortTokens.length === 1) {
    return false;
  }

  return shortTokens.every((token) => hasTokenCompatible(token, fullTokens));
}

function scoreCandidate(input: {
  shortNameNormalized: string;
  observedRanking: number | null;
  observedRating: number | null;
  observedClub: string | null;
  candidate: AthleteResolverCandidate;
}): AthleteResolutionCandidateScore {
  const shortTokens = tokenizeNormalizedName(input.shortNameNormalized);
  const fullTokens = tokenizeNormalizedName(input.candidate.nameNormalized);

  const reasons: string[] = [];
  let score = 0;

  const hasObservedPoints =
    Number.isInteger(input.observedRanking) && Number.isInteger(input.observedRating);

  if (
    hasObservedPoints &&
    input.candidate.rankingPoints === input.observedRanking &&
    input.candidate.ratingPoints === input.observedRating
  ) {
    score += 60;
    reasons.push("ranking+rating iguais");
  }

  const shortFirst = shortTokens[0] ?? "";
  const shortLast = shortTokens[shortTokens.length - 1] ?? "";
  const fullFirst = fullTokens[0] ?? "";
  const fullLast = fullTokens[fullTokens.length - 1] ?? "";

  if (shortLast && (shortLast === fullLast || isNearToken(shortLast, fullLast))) {
    score += 20;
    reasons.push(shortLast === fullLast ? "sobrenome final igual" : "sobrenome final aproximado");
  }

  if (shortFirst && (shortFirst === fullFirst || isNearToken(shortFirst, fullFirst))) {
    score += 15;
    reasons.push(shortFirst === fullFirst ? "primeiro nome igual" : "primeiro nome aproximado");
  }

  if (shortTokens.length > 0 && shortTokens.every((token) => hasTokenCompatible(token, fullTokens))) {
    score += 10;
    reasons.push("todos os tokens do nome curto compativeis");
  }

  if (input.observedClub && input.candidate.clubNormalizedName === input.observedClub) {
    score += 10;
    reasons.push("clube compatível");
  }

  return {
    athleteId: input.candidate.athleteId,
    nameDisplay: input.candidate.nameDisplay,
    rankingPoints: input.candidate.rankingPoints,
    ratingPoints: input.candidate.ratingPoints,
    score,
    reasons,
  };
}

function selectTopCandidate(
  scoredCandidates: AthleteResolutionCandidateScore[],
): { accepted: boolean; top?: AthleteResolutionCandidateScore; scored: AthleteResolutionCandidateScore[] } {
  if (scoredCandidates.length === 0) {
    return {
      accepted: false,
      scored: [],
    };
  }

  const sorted = [...scoredCandidates].sort((a, b) => b.score - a.score);
  const top = { ...sorted[0] };
  const second = sorted[1];

  if (second && top.score - second.score < 15) {
    top.score -= 30;
    top.reasons = [...top.reasons, "penalidade por ambiguidade"]; // candidatos muito próximos
    sorted[0] = top;
  }

  const effectiveSecond = sorted[1];
  const diffToSecond = effectiveSecond ? top.score - effectiveSecond.score : Number.MAX_SAFE_INTEGER;
  const accepted = top.score >= 80 && diffToSecond >= 15;

  return {
    accepted,
    top,
    scored: sorted,
  };
}

export function resolveAthleteCandidate(input: AthleteResolutionInput): AthleteResolutionResult {
  const shortNameNormalized = normalizeAthleteAliasKey(
    input.shortNameNormalized ?? input.shortName,
  );
  const observedRanking: number | null = Number.isInteger(input.rankingPoints) ? Number(input.rankingPoints) : null;
  const observedRating: number | null = Number.isInteger(input.ratingPoints) ? Number(input.ratingPoints) : null;
  const observedClub = normalizeText(input.clubNormalizedName ?? null) || null;

  const sameEventCandidates = input.candidates.filter((candidate) => candidate.eventId === input.eventId);

  const exactAliasCandidates = sameEventCandidates.filter(
    (candidate) =>
      normalizeAthleteAliasKey(candidate.nameNormalized) === shortNameNormalized ||
      candidate.aliasesNormalized.some(
        (alias) => normalizeAthleteAliasKey(alias) === shortNameNormalized,
      ),
  );

  if (exactAliasCandidates.length === 1) {
    const direct = exactAliasCandidates[0];
    return {
      status: "resolved",
      strategy: "alias-exato",
      athleteId: direct.athleteId,
      score: 100,
      reasons: ["alias exato encontrado"],
      scoredCandidates: [
        {
          athleteId: direct.athleteId,
          nameDisplay: direct.nameDisplay,
          rankingPoints: direct.rankingPoints,
          ratingPoints: direct.ratingPoints,
          score: 100,
          reasons: ["alias exato"],
        },
      ],
    };
  }

  const hasObservedPoints = observedRanking !== null && observedRating !== null;

  if (hasObservedPoints) {
    const strongCandidates = sameEventCandidates
      .filter(
        (candidate) =>
          candidate.rankingPoints === observedRanking &&
          candidate.ratingPoints === observedRating &&
          isBaseNameCompatible(shortNameNormalized, candidate.nameNormalized),
      )
      .map((candidate) =>
        scoreCandidate({
          shortNameNormalized,
          observedRanking,
          observedRating,
          observedClub,
          candidate,
        }),
      );

    if (strongCandidates.length === 1) {
      const single = strongCandidates[0];
      return {
        status: "resolved",
        strategy: "forte-ranking-rating",
        athleteId: single.athleteId,
        score: single.score,
        reasons: [...single.reasons, "match forte por ranking/rating"],
        scoredCandidates: strongCandidates,
      };
    }

    if (strongCandidates.length > 1) {
      const strongDecision = selectTopCandidate(strongCandidates);
      if (strongDecision.accepted && strongDecision.top) {
        return {
          status: "resolved",
          strategy: "forte-ranking-rating",
          athleteId: strongDecision.top.athleteId,
          score: strongDecision.top.score,
          reasons: strongDecision.top.reasons,
          scoredCandidates: strongDecision.scored,
        };
      }

      return {
        status: "conflict",
        strategy: "forte-ranking-rating",
        scoredCandidates: strongDecision.scored,
      };
    }

    const ratingCandidates = sameEventCandidates
      .filter(
        (candidate) =>
          candidate.ratingPoints === observedRating &&
          isBaseNameCompatible(shortNameNormalized, candidate.nameNormalized),
      )
      .map((candidate) =>
        scoreCandidate({
          shortNameNormalized,
          observedRanking,
          observedRating,
          observedClub,
          candidate,
        }),
      );

    const rankingCandidates = sameEventCandidates
      .filter(
        (candidate) =>
          candidate.rankingPoints === observedRanking &&
          isBaseNameCompatible(shortNameNormalized, candidate.nameNormalized),
      )
      .map((candidate) =>
        scoreCandidate({
          shortNameNormalized,
          observedRanking,
          observedRating,
          observedClub,
          candidate,
        }),
      );

    if (ratingCandidates.length === 1 && rankingCandidates.length <= 1) {
      const byRating = ratingCandidates[0];
      const rankingConflict =
        rankingCandidates.length === 1 && rankingCandidates[0].athleteId !== byRating.athleteId;
      if (!rankingConflict) {
        return {
          status: "resolved",
          strategy: "forte-ranking-rating",
          athleteId: byRating.athleteId,
          score: byRating.score,
          reasons: [...byRating.reasons, "match por rating + nome (ranking divergente)"],
          scoredCandidates: ratingCandidates,
        };
      }
    }

    if (rankingCandidates.length === 1 && ratingCandidates.length <= 1) {
      const byRanking = rankingCandidates[0];
      const ratingConflict =
        ratingCandidates.length === 1 && ratingCandidates[0].athleteId !== byRanking.athleteId;
      if (!ratingConflict) {
        return {
          status: "resolved",
          strategy: "forte-ranking-rating",
          athleteId: byRanking.athleteId,
          score: byRanking.score,
          reasons: [...byRanking.reasons, "match por ranking + nome (rating divergente)"],
          scoredCandidates: rankingCandidates,
        };
      }
    }
  }

  let heuristicPool = sameEventCandidates.filter((candidate) => {
    if (hasObservedPoints) {
      return candidate.rankingPoints === observedRanking && candidate.ratingPoints === observedRating;
    }

    if (observedClub) {
      return candidate.clubNormalizedName === observedClub;
    }

    return true;
  });

  if (hasObservedPoints && heuristicPool.length === 0) {
    heuristicPool = sameEventCandidates.filter(
      (candidate) =>
        candidate.rankingPoints === observedRanking || candidate.ratingPoints === observedRating,
    );
  }

  const compatibleCandidates = heuristicPool.filter((candidate) =>
    isBaseNameCompatible(shortNameNormalized, candidate.nameNormalized),
  );

  const scored = compatibleCandidates.map((candidate) =>
    scoreCandidate({
      shortNameNormalized,
      observedRanking,
      observedRating,
      observedClub,
      candidate,
    }),
  );

  const decision = selectTopCandidate(scored);
  if (decision.accepted && decision.top) {
    return {
      status: "resolved",
      strategy: "heuristica",
      athleteId: decision.top.athleteId,
      score: decision.top.score,
      reasons: decision.top.reasons,
      scoredCandidates: decision.scored,
    };
  }

  if (!hasObservedPoints && decision.top) {
    const second = decision.scored[1];
    const diffToSecond = second ? decision.top.score - second.score : Number.MAX_SAFE_INTEGER;
    const hasStrongNameSignal =
      decision.top.reasons.some((reason) => reason.includes("sobrenome final")) &&
      decision.top.reasons.some((reason) => reason.includes("primeiro nome"));

    if (decision.top.score >= 40 && diffToSecond >= 20 && hasStrongNameSignal) {
      return {
        status: "resolved",
        strategy: "heuristica",
        athleteId: decision.top.athleteId,
        score: decision.top.score,
        reasons: [...decision.top.reasons, "match dominante por nome (sem pontos)"],
        scoredCandidates: decision.scored,
      };
    }
  }

  return {
    status: "conflict",
    strategy: "heuristica",
    scoredCandidates: decision.scored,
  };
}

export function normalizeText(input: string | null | undefined): string {
  return (input ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeAthleteName(input: string | null | undefined): string {
  return (input ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isDoublesLikeLabel(input: string | null | undefined): boolean {
  const normalized = normalizeText(input).replace(/\s+/g, " ").trim();
  if (!normalized) {
    return false;
  }
  return /\bdupla(?:s)?\b/.test(normalized);
}

function splitDoublesPairParts(input: string | null | undefined): string[] {
  return compactWhitespace(input)
    .split(/\s+#\s+|#|\s+-\s+/g)
    .map((part) => compactWhitespace(part))
    .filter(Boolean);
}

function normalizePairMemberKey(input: string | null | undefined): string {
  return normalizeAthleteName(input);
}

function arePairMemberNamesEquivalent(left: string | null | undefined, right: string | null | undefined): boolean {
  const leftKey = normalizePairMemberKey(left);
  const rightKey = normalizePairMemberKey(right);
  if (!leftKey || !rightKey) {
    return false;
  }
  return leftKey === rightKey || leftKey.includes(rightKey) || rightKey.includes(leftKey);
}

function areCompetitiveEntryNamesEquivalent(left: string | null | undefined, right: string | null | undefined): boolean {
  const leftParts = splitDoublesPairParts(left);
  const rightParts = splitDoublesPairParts(right);

  if (leftParts.length >= 2 || rightParts.length >= 2) {
    if (leftParts.length < 2 || rightParts.length < 2) {
      return false;
    }
    const remaining = [...rightParts];
    for (const leftPart of leftParts) {
      const matchIndex = remaining.findIndex((rightPart) => arePairMemberNamesEquivalent(leftPart, rightPart));
      if (matchIndex === -1) {
        return false;
      }
      remaining.splice(matchIndex, 1);
    }
    return remaining.length === 0;
  }

  return arePairMemberNamesEquivalent(left, right);
}

export function normalizeDoublesPairName(input: string | null | undefined): string {
  const value = compactWhitespace(input);
  const parts = splitDoublesPairParts(value);
  if (parts.length < 2) {
    return value;
  }

  const deduped = new Map<string, string>();
  for (const part of parts) {
    const key = normalizeText(part);
    if (!key || deduped.has(key)) {
      continue;
    }
    deduped.set(key, part);
  }

  const sorted = [...deduped.entries()].sort((a, b) => a[0].localeCompare(b[0], "pt-BR"));
  if (sorted.length < 2) {
    return value;
  }

  return sorted.map(([, display]) => display).join(" # ");
}

export function shouldNormalizeDoublesPairName(
  eventName: string | null | undefined,
  categoryName: string | null | undefined,
  athleteName: string | null | undefined,
): boolean {
  if (splitDoublesPairParts(athleteName).length < 2) {
    return false;
  }
  return isDoublesLikeLabel(eventName) || isDoublesLikeLabel(categoryName);
}

export function resolveAthleteIndexInMatch(
  match: MatchPerformanceInput,
  athlete: AthletePerformanceInput,
): 0 | 1 | null {
  const players = Array.isArray(match.players) ? match.players : [];
  if (players.length < 2) {
    return null;
  }

  const athleteIds = new Set<number>();
  if (typeof athlete.athleteId === "number") {
    athleteIds.add(athlete.athleteId);
  }
  for (const value of athlete.athleteIds ?? []) {
    if (typeof value === "number") {
      athleteIds.add(value);
    }
  }

  const athletePairNameNormalized = normalizeAthleteName(normalizeDoublesPairName(athlete.athleteName ?? null));
  const athleteNameNormalized = normalizeAthleteName(athlete.athleteNameNormalized ?? athlete.athleteName ?? null);
  const athleteName = athlete.athleteName ?? athlete.athleteNameNormalized ?? null;

  for (let index = 0; index < 2; index += 1) {
    const player = players[index];
    if (!player) {
      continue;
    }

    if (typeof player.athleteId === "number" && athleteIds.has(player.athleteId)) {
      return index === 0 ? 0 : 1;
    }

    const playerPairNameNormalized = normalizeAthleteName(normalizeDoublesPairName(player.name ?? null));
    const playerNameNormalized = normalizeAthleteName(player.name ?? null);
    if (
      areCompetitiveEntryNamesEquivalent(athleteName, player.name ?? null) ||
      (athletePairNameNormalized && playerPairNameNormalized === athletePairNameNormalized) ||
      (athleteNameNormalized && playerNameNormalized === athleteNameNormalized)
    ) {
      return index === 0 ? 0 : 1;
    }
  }

  return null;
}

export function getAthleteMatchOutcome(input: {
  winnerIndex: 0 | 1 | null | undefined;
  athleteIndex: 0 | 1 | null | undefined;
}): "W" | "L" | null {
  if (input.winnerIndex !== 0 && input.winnerIndex !== 1) {
    return null;
  }
  if (input.athleteIndex !== 0 && input.athleteIndex !== 1) {
    return null;
  }
  return input.winnerIndex === input.athleteIndex ? "W" : "L";
}

export function calculateAthletePointPerformance(
  matches: MatchPerformanceInput[],
  athlete: AthletePerformanceInput,
): AthletePointPerformance {
  const isWalkoverPerformanceMatch = (match: MatchPerformanceInput): boolean => {
    const sets = Array.isArray(match.sets) ? match.sets : [];
    if (sets.length !== 3) {
      return false;
    }

    if (sets.every((set) => Number(set?.p1) === 0 && Number(set?.p2) === 0)) {
      return true;
    }

    if (sets.every((set) => Number(set?.p1) === 11 && Number(set?.p2) === 0)) {
      return true;
    }

    if (sets.every((set) => Number(set?.p1) === 0 && Number(set?.p2) === 11)) {
      return true;
    }

    return false;
  };

  let pointsWon = 0;
  let pointsPlayed = 0;
  let setsUsed = 0;
  let ignoredSets = 0;
  let matchesConsidered = 0;

  for (const match of matches) {
    const athleteIndex = resolveAthleteIndexInMatch(match, athlete);
    if (athleteIndex === null) {
      continue;
    }

    matchesConsidered += 1;

    if (isWalkoverPerformanceMatch(match)) {
      ignoredSets += (match.sets ?? []).length;
      continue;
    }

    for (const set of match.sets ?? []) {
      const p1 = Number(set?.p1);
      const p2 = Number(set?.p2);

      const valid =
        Number.isFinite(p1) &&
        Number.isFinite(p2) &&
        p1 >= 0 &&
        p2 >= 0 &&
        p1 + p2 > 0;

      if (!valid) {
        ignoredSets += 1;
        continue;
      }

      setsUsed += 1;
      pointsPlayed += p1 + p2;
      pointsWon += athleteIndex === 0 ? p1 : p2;
    }
  }

  return {
    pointsWon,
    pointsPlayed,
    ratio: pointsPlayed > 0 ? pointsWon / pointsPlayed : null,
    setsUsed,
    ignoredSets,
    matchesConsidered,
  };
}

export function compactWhitespace(input: string | null | undefined): string {
  return (input ?? "").replace(/\s+/g, " ").trim();
}

export function computeMatchKey(input: MatchKeyInput): string {
  const athletes = [normalizeText(input.athleteA), normalizeText(input.athleteB)].sort();

  const payload = [
    String(input.eventId),
    normalizeText(input.categoryNormalized),
    input.phase,
    normalizeText(input.round ?? "na"),
    normalizeText(input.tableNumber ?? "na"),
    normalizeText(input.matchDatetime ?? "na"),
    athletes[0],
    athletes[1],
  ].join("|");

  return createHash("sha1").update(payload).digest("hex");
}

export function normalizeLegacyMatchPhase(
  phase: MatchPhase | string | null | undefined,
): "INSCRICOES" | "GRUPOS" | "RESULTADOS" {
  switch ((phase ?? "").toString().trim().toUpperCase()) {
    case "INSCRICOES":
      return "INSCRICOES";
    case "GRUPOS":
      return "GRUPOS";
    case "ELIMINATORIA":
    case "RESULTADOS":
      return "RESULTADOS";
    default:
      return "RESULTADOS";
  }
}

export function getMatchPhaseOrder(phase: MatchPhase | string | null | undefined): number {
  switch (normalizeLegacyMatchPhase(phase)) {
    case "GRUPOS":
      return 1;
    case "RESULTADOS":
      return 2;
    case "INSCRICOES":
      return 3;
    default:
      return 99;
  }
}

export function getRoundSemanticOrder(round: string | null | undefined): number {
  const normalized = normalizeText(round ?? "");
  if (!normalized) {
    return 999;
  }

  if (/\bpre\b/.test(normalized)) {
    return 10;
  }
  if (/\b32\b/.test(normalized) || /\b1\/32\b/.test(normalized)) {
    return 20;
  }
  if (/\b16\b/.test(normalized) || /\b1\/16\b/.test(normalized)) {
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

  const jogoMatch = normalized.match(/\bjogo\s*0*(\d+)\b/);
  if (jogoMatch) {
    return 100 + Number(jogoMatch[1]);
  }

  const numberMatch = normalized.match(/\b(\d+)\b/);
  if (numberMatch) {
    return 500 + Number(numberMatch[1]);
  }

  return 900;
}

export function parseBrazilianDateTime(dateText: string | null, timeText: string | null): string | null {
  if (!dateText) {
    return null;
  }

  const dateMatch = dateText.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!dateMatch) {
    return null;
  }

  const [, dd, mm, yyyy] = dateMatch;
  const time = timeText && /^\d{1,2}:\d{2}$/.test(timeText) ? timeText.padStart(5, "0") : "00:00";

  // O site CBTM exibe horario local de Belem (UTC-03:00, sem horario de verao).
  // Persistimos com offset explicito para evitar deslocamento de -3h no frontend.
  return `${yyyy}-${mm}-${dd}T${time}:00-03:00`;
}

export function isLikelyAthleteName(value: string): boolean {
  const v = compactWhitespace(value);
  if (!v || /\d/.test(v)) {
    return false;
  }

  if (/^jogo\b/i.test(v) || /^mesa\b/i.test(v) || /^grupo\b/i.test(v)) {
    return false;
  }

  return /[a-zA-ZÀ-ÿ]{2,}/.test(v);
}

