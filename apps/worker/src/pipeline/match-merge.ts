import {
  ParsedMatch,
  ParsedMatchSet,
  compactWhitespace,
  normalizeText,
} from "@cbtm/shared";
import { parseScoreRaw } from "./score-parser";

export interface MergeMatchesResult {
  matches: ParsedMatch[];
  warnings: string[];
}

interface MatchIdentity {
  key: string;
  participantsKey: string;
}

interface ParsedSourceFlags {
  resultados: boolean;
  eliminatoria: boolean;
}

function parseIsoDate(input: string | null | undefined): Date | null {
  if (!input) {
    return null;
  }

  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isNumericString(value: string | null | undefined): boolean {
  return /^\d+$/.test(compactWhitespace(value ?? ""));
}

function normalizeMatchDay(match: ParsedMatch): string | null {
  const fromIso = parseIsoDate(match.matchDatetime);
  if (fromIso) {
    return fromIso.toISOString().slice(0, 10);
  }

  const rawDate = compactWhitespace(String(match.metadata?.rawDate ?? ""));
  const dateMatch = rawDate.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!dateMatch) {
    return null;
  }

  const [, dd, mm, yyyy] = dateMatch;
  return `${yyyy}-${mm}-${dd}`;
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
  return null;
}

function extractCbtmMatchId(match: ParsedMatch): string | null {
  const fromMetadataKeys = [
    match.metadata?.cbtmMatchId,
    match.metadata?.matchId,
    match.metadata?.gameId,
    match.metadata?.jogo,
  ];

  for (const value of fromMetadataKeys) {
    const asText = compactWhitespace(String(value ?? ""));
    if (!asText) {
      continue;
    }
    if (isNumericString(asText)) {
      return String(Number(asText));
    }
    const digits = asText.match(/\d+/)?.[0];
    if (digits) {
      return String(Number(digits));
    }
  }

  return extractGameIdFromRound(match.round);
}

function buildIdentity(eventId: number, match: ParsedMatch): MatchIdentity {
  const categoryKey = getMatchCategoryKey(match);
  const participantsKey = getMatchParticipantsKey(match);
  const day = normalizeMatchDay(match) ?? "sem-dia";
  const roundGameId = extractGameIdFromRound(match.round) ?? "sem-rodada";
  const table = compactWhitespace(match.tableNumber ?? "") || "sem-mesa";
  const cbtmMatchId = extractCbtmMatchId(match);

  if (cbtmMatchId) {
    return {
      key: `cbtm|${eventId}|${categoryKey}|${cbtmMatchId}`,
      participantsKey,
    };
  }

  return {
    key: [
      "fallback",
      String(eventId),
      categoryKey,
      participantsKey,
      day,
      `round:${roundGameId}`,
      `mesa:${table}`,
    ].join("|"),
    participantsKey,
  };
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

function parseFinalFromMatch(match: ParsedMatch): { p1Sets: number; p2Sets: number } | null {
  if (match.setsResult) {
    return {
      p1Sets: Number(match.setsResult.p1Sets),
      p2Sets: Number(match.setsResult.p2Sets),
    };
  }

  const parsed = parseScoreRaw(match.scoreRaw);
  if (parsed?.final) {
    return {
      p1Sets: parsed.final.setsA,
      p2Sets: parsed.final.setsB,
    };
  }

  const sets = sanitizeParsedMatchSets(match.sets);
  if (sets.length === 0) {
    return null;
  }

  let p1Wins = 0;
  let p2Wins = 0;
  for (const set of sets) {
    if (set.p1 > set.p2) {
      p1Wins += 1;
    } else if (set.p2 > set.p1) {
      p2Wins += 1;
    }
  }
  if (p1Wins === 0 && p2Wins === 0) {
    return null;
  }
  return { p1Sets: p1Wins, p2Sets: p2Wins };
}

function parseSetsFromMatch(match: ParsedMatch): ParsedMatchSet[] {
  const fromParsedSets = sanitizeParsedMatchSets(match.sets);
  if (fromParsedSets.length > 0) {
    return fromParsedSets;
  }

  const parsed = parseScoreRaw(match.scoreRaw);
  if (!parsed?.sets?.length) {
    return [];
  }

  return parsed.sets
    .map((set) => ({
      p1: Number(set.a),
      p2: Number(set.b),
    }))
    .filter((set) => Number.isFinite(set.p1) && Number.isFinite(set.p2));
}

function inferSourceFlags(match: ParsedMatch): ParsedSourceFlags {
  const metadataSource = normalizeText(String(match.metadata?.source ?? ""));
  const sourceUrl = compactWhitespace(match.sourceUrl ?? "");

  const fromModel = match.sourceFlags ?? null;
  const resultFromModel = Boolean(fromModel?.resultados);
  const eliminationFromModel = Boolean(fromModel?.eliminatoria);

  const eliminatoria =
    eliminationFromModel ||
    metadataSource === "api-game-result" ||
    sourceUrl.includes("/api/GameResult/");
  const resultados = resultFromModel || !eliminatoria;

  return {
    resultados,
    eliminatoria,
  };
}

function pickPreferredName(current: string, next: string): string {
  const currentClean = compactWhitespace(current);
  const nextClean = compactWhitespace(next);
  if (!currentClean) {
    return nextClean;
  }
  if (!nextClean) {
    return currentClean;
  }

  const currentTokens = currentClean.split(/\s+/g).length;
  const nextTokens = nextClean.split(/\s+/g).length;
  if (nextTokens !== currentTokens) {
    return nextTokens > currentTokens ? nextClean : currentClean;
  }

  return nextClean.length > currentClean.length ? nextClean : currentClean;
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

function getRoundHierarchyOrder(round: string | null | undefined): number {
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

  return 999;
}

function withOrientation<T extends { p1: number; p2: number }>(
  value: T,
  swapped: boolean,
): T {
  if (!swapped) {
    return value;
  }

  return {
    ...value,
    p1: value.p2,
    p2: value.p1,
  };
}

function resolveOrientation(base: ParsedMatch, observed: ParsedMatch): { swapped: boolean; compatible: boolean } {
  const baseA = base.athleteANormalizedName || normalizeText(base.athleteAName);
  const baseB = base.athleteBNormalizedName || normalizeText(base.athleteBName);
  const observedA = observed.athleteANormalizedName || normalizeText(observed.athleteAName);
  const observedB = observed.athleteBNormalizedName || normalizeText(observed.athleteBName);

  if (baseA === observedA && baseB === observedB) {
    return { swapped: false, compatible: true };
  }
  if (baseA === observedB && baseB === observedA) {
    return { swapped: true, compatible: true };
  }
  return { swapped: false, compatible: false };
}

function hasExplicitTime(match: ParsedMatch): boolean {
  const raw = compactWhitespace(match.matchDatetime ?? "");
  if (!raw) {
    return false;
  }
  const date = parseIsoDate(raw);
  if (!date) {
    return false;
  }
  return date.getUTCHours() !== 0 || date.getUTCMinutes() !== 0 || date.getUTCSeconds() !== 0;
}

function getScoreRawQuality(scoreRaw: string | null | undefined): number {
  const parsed = parseScoreRaw(scoreRaw);
  const normalized = compactWhitespace(scoreRaw ?? "");
  let score = normalized.length;
  if (parsed?.final) {
    score += 100;
  }
  if ((parsed?.sets?.length ?? 0) > 0) {
    score += 200 + (parsed?.sets.length ?? 0) * 10;
  }
  return score;
}

function sourcePriority(match: ParsedMatch): number {
  const flags = inferSourceFlags(match);
  if (flags.resultados && flags.eliminatoria) {
    return 4;
  }
  if (flags.resultados) {
    return 3;
  }
  if (flags.eliminatoria) {
    return 2;
  }
  return 1;
}

function metadataCompletenessScore(match: ParsedMatch): number {
  let score = 0;
  if (compactWhitespace(match.round ?? "")) {
    score += 30;
  }
  if (compactWhitespace(match.tableNumber ?? "")) {
    score += 30;
  }
  if (parseIsoDate(match.matchDatetime)) {
    score += 30;
  }
  if (extractCbtmMatchId(match)) {
    score += 30;
  }
  return score;
}

function mergeMetadata(base: ParsedMatch["metadata"], next: ParsedMatch["metadata"]): ParsedMatch["metadata"] {
  if (!base && !next) {
    return undefined;
  }

  const merged: Record<string, string | number | null> = {
    ...(base ?? {}),
  };

  for (const [key, value] of Object.entries(next ?? {})) {
    if (!(key in merged)) {
      merged[key] = value;
      continue;
    }

    const current = merged[key];
    if (
      (current === null || current === "" || current === "sem-dado") &&
      value !== null &&
      value !== "" &&
      value !== "sem-dado"
    ) {
      merged[key] = value;
    }
  }

  return merged;
}

function chooseSeedMatch(group: ParsedMatch[]): ParsedMatch {
  return [...group].sort((a, b) => {
    const setsA = parseSetsFromMatch(a).length;
    const setsB = parseSetsFromMatch(b).length;
    if (setsA !== setsB) {
      return setsB - setsA;
    }

    const finalA = parseFinalFromMatch(a) ? 1 : 0;
    const finalB = parseFinalFromMatch(b) ? 1 : 0;
    if (finalA !== finalB) {
      return finalB - finalA;
    }

    const completenessA = metadataCompletenessScore(a);
    const completenessB = metadataCompletenessScore(b);
    if (completenessA !== completenessB) {
      return completenessB - completenessA;
    }

    const priorityA = sourcePriority(a);
    const priorityB = sourcePriority(b);
    if (priorityA !== priorityB) {
      return priorityB - priorityA;
    }

    const hasDateA = parseIsoDate(a.matchDatetime) ? 1 : 0;
    const hasDateB = parseIsoDate(b.matchDatetime) ? 1 : 0;
    if (hasDateA !== hasDateB) {
      return hasDateB - hasDateA;
    }

    return a.matchKey.localeCompare(b.matchKey);
  })[0];
}

function resolveWinnerIndex(match: ParsedMatch): 0 | 1 | null {
  if (match.winnerIndex === 0 || match.winnerIndex === 1) {
    return match.winnerIndex;
  }

  const final = parseFinalFromMatch(match);
  if (final) {
    if (final.p1Sets > final.p2Sets) {
      return 0;
    }
    if (final.p2Sets > final.p1Sets) {
      return 1;
    }
  }

  const sets = parseSetsFromMatch(match);
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

  return null;
}

function mergeGroup(eventId: number, group: ParsedMatch[], warnings: string[]): ParsedMatch {
  const seed = chooseSeedMatch(group);
  const merged: ParsedMatch = {
    ...seed,
    metadata: {
      ...(seed.metadata ?? {}),
    },
  };

  let mergedSets = parseSetsFromMatch(merged);
  let mergedFinal = parseFinalFromMatch(merged);
  let mergedScoreRaw = merged.scoreRaw;
  let mergedCbtmMatchId = extractCbtmMatchId(merged);
  const mergedFlags = inferSourceFlags(merged);

  for (const candidate of group) {
    if (candidate.matchKey === merged.matchKey) {
      continue;
    }

    const orientation = resolveOrientation(merged, candidate);
    if (!orientation.compatible) {
      warnings.push(
        `merge-warning: participantes divergentes para chave candidata ${eventId}:${merged.matchKey}/${candidate.matchKey}.`,
      );
      continue;
    }

    const candidateAName = orientation.swapped ? candidate.athleteBName : candidate.athleteAName;
    const candidateBName = orientation.swapped ? candidate.athleteAName : candidate.athleteBName;
    merged.athleteAName = pickPreferredName(merged.athleteAName, candidateAName);
    merged.athleteBName = pickPreferredName(merged.athleteBName, candidateBName);
    merged.athleteANormalizedName = normalizeText(merged.athleteAName);
    merged.athleteBNormalizedName = normalizeText(merged.athleteBName);

    const specificityMerged = getRoundSpecificity(merged.round);
    const specificityCandidate = getRoundSpecificity(candidate.round);
    if (specificityCandidate > specificityMerged) {
      merged.round = candidate.round;
    } else if (specificityCandidate === specificityMerged) {
      const hierarchyMerged = getRoundHierarchyOrder(merged.round);
      const hierarchyCandidate = getRoundHierarchyOrder(candidate.round);
      if (hierarchyCandidate < hierarchyMerged) {
        merged.round = candidate.round;
      }
    }

    if (!merged.tableNumber && candidate.tableNumber) {
      merged.tableNumber = candidate.tableNumber;
    } else if (
      merged.tableNumber &&
      candidate.tableNumber &&
      compactWhitespace(merged.tableNumber) !== compactWhitespace(candidate.tableNumber) &&
      sourcePriority(candidate) > sourcePriority(merged)
    ) {
      merged.tableNumber = candidate.tableNumber;
    }

    const mergedDate = parseIsoDate(merged.matchDatetime);
    const candidateDate = parseIsoDate(candidate.matchDatetime);
    if (!mergedDate && candidateDate) {
      merged.matchDatetime = candidate.matchDatetime;
    } else if (mergedDate && candidateDate && mergedDate.getTime() !== candidateDate.getTime()) {
      const mergedHasTime = hasExplicitTime(merged);
      const candidateHasTime = hasExplicitTime(candidate);
      if (!mergedHasTime && candidateHasTime) {
        merged.matchDatetime = candidate.matchDatetime;
      } else if (mergedHasTime === candidateHasTime) {
        if (sourcePriority(candidate) > sourcePriority(merged)) {
          merged.matchDatetime = candidate.matchDatetime;
        }
        warnings.push(
          `merge-warning: datetime divergente para match ${merged.matchKey} (${merged.matchDatetime} vs ${candidate.matchDatetime}).`,
        );
      }
    }

    const candidateSets = parseSetsFromMatch(candidate).map((set) =>
      withOrientation(set, orientation.swapped),
    );
    if (candidateSets.length > mergedSets.length) {
      mergedSets = candidateSets;
    }

    const rawCandidateFinal = parseFinalFromMatch(candidate);
    const candidateFinal = rawCandidateFinal
      ? withOrientation(
          { p1: rawCandidateFinal.p1Sets, p2: rawCandidateFinal.p2Sets },
          orientation.swapped,
        )
      : null;

    if (!mergedFinal && candidateFinal) {
      mergedFinal = {
        p1Sets: candidateFinal.p1,
        p2Sets: candidateFinal.p2,
      };
    } else if (
      mergedFinal &&
      candidateFinal &&
      (mergedFinal.p1Sets !== candidateFinal.p1 || mergedFinal.p2Sets !== candidateFinal.p2)
    ) {
      warnings.push(
        `merge-warning: score final divergente para match ${merged.matchKey} (${mergedFinal.p1Sets}-${mergedFinal.p2Sets} vs ${candidateFinal.p1}-${candidateFinal.p2}).`,
      );
    }

    if (getScoreRawQuality(candidate.scoreRaw) > getScoreRawQuality(mergedScoreRaw)) {
      mergedScoreRaw = candidate.scoreRaw;
    }

    const candidateMatchId = extractCbtmMatchId(candidate);
    if (!mergedCbtmMatchId && candidateMatchId) {
      mergedCbtmMatchId = candidateMatchId;
    }

    const candidateFlags = inferSourceFlags(candidate);
    mergedFlags.resultados = mergedFlags.resultados || candidateFlags.resultados;
    mergedFlags.eliminatoria = mergedFlags.eliminatoria || candidateFlags.eliminatoria;

    if (!merged.sourceUrl && candidate.sourceUrl) {
      merged.sourceUrl = candidate.sourceUrl;
    }

    merged.metadata = mergeMetadata(merged.metadata, candidate.metadata);
  }

  if (mergedSets.length > 0) {
    merged.sets = mergedSets;
    let p1Wins = 0;
    let p2Wins = 0;
    for (const set of mergedSets) {
      if (set.p1 > set.p2) {
        p1Wins += 1;
      } else if (set.p2 > set.p1) {
        p2Wins += 1;
      }
    }

    if (p1Wins > 0 || p2Wins > 0) {
      mergedFinal = { p1Sets: p1Wins, p2Sets: p2Wins };
    }
  }

  merged.setsResult = mergedFinal;
  merged.scoreRaw = mergedScoreRaw;
  merged.cbtmMatchId = mergedCbtmMatchId;
  merged.sourceFlags = mergedFlags;
  merged.winnerIndex = resolveWinnerIndex(merged);
  merged.metadata = {
    ...(merged.metadata ?? {}),
    sourceResultados: mergedFlags.resultados ? 1 : 0,
    sourceEliminatoria: mergedFlags.eliminatoria ? 1 : 0,
    mergedFromSources: group.length,
  };

  if (mergedFlags.resultados && merged.setsResult && (merged.sets?.length ?? 0) === 0) {
    warnings.push(
      `merge-warning: resultado consolidado sem sets detalhados (${merged.matchKey} | ${merged.athleteAName} x ${merged.athleteBName}).`,
    );
  }

  return merged;
}

export function mergeMatchesAcrossSources(
  eventId: number,
  matches: ParsedMatch[],
): MergeMatchesResult {
  const warnings: string[] = [];
  const groups = new Map<string, ParsedMatch[]>();

  for (const match of matches) {
    const identity = buildIdentity(eventId, match);
    const group = groups.get(identity.key);
    if (!group) {
      groups.set(identity.key, [match]);
      continue;
    }

    const firstIdentity = buildIdentity(eventId, group[0]);
    if (firstIdentity.participantsKey !== identity.participantsKey) {
      const splitKey = `${identity.key}|participants:${identity.participantsKey}`;
      warnings.push(
        `merge-warning: conflito de participantes na identidade ${identity.key}. Mantendo grupos separados.`,
      );
      const splitGroup = groups.get(splitKey) ?? [];
      splitGroup.push(match);
      groups.set(splitKey, splitGroup);
      continue;
    }

    group.push(match);
  }

  const mergedMatches = [...groups.values()].map((group) => mergeGroup(eventId, group, warnings));
  return {
    matches: mergedMatches,
    warnings,
  };
}
