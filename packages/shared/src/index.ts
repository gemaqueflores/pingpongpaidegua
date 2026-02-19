import { createHash } from "crypto";
export * from "./event-situation";
export * from "./brazil-states";
export * from "./registration-status";

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

  const overlap = shortTokens.filter((token) => hasTokenCompatible(token, fullTokens));
  const firstLast = `${fullTokens[0]} ${fullTokens[fullTokens.length - 1]}`;

  return overlap.length >= 1 || normalizeAthleteAliasKey(shortNameNormalized) === firstLast;
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

  const athleteNameNormalized = normalizeAthleteName(
    athlete.athleteNameNormalized ?? athlete.athleteName ?? null,
  );

  for (let index = 0; index < 2; index += 1) {
    const player = players[index];
    if (!player) {
      continue;
    }

    if (typeof player.athleteId === "number" && athleteIds.has(player.athleteId)) {
      return index === 0 ? 0 : 1;
    }

    const playerNameNormalized = normalizeAthleteName(player.name ?? null);
    if (athleteNameNormalized && playerNameNormalized === athleteNameNormalized) {
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

export function getMatchPhaseOrder(phase: MatchPhase | string | null | undefined): number {
  switch ((phase ?? "").toString().toUpperCase()) {
    case "GRUPOS":
      return 1;
    case "ELIMINATORIA":
      return 2;
    case "RESULTADOS":
      return 3;
    case "INSCRICOES":
      return 4;
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

