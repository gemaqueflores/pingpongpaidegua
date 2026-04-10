import {
  AthletePerformanceInput,
  calculateAthletePointPerformance,
  compactWhitespace,
  detectWalkover,
  normalizeAthleteName,
  resolveAthleteIndexInMatch,
} from "@cbtm/shared";

export interface CategoryAnalyticsPlayer {
  athleteId: number | null;
  name: string | null;
}

export interface CategoryAnalyticsMatch {
  categoryId: number;
  categoryName: string;
  phase: string;
  round: string | null;
  scoreRaw?: string | null;
  players: [CategoryAnalyticsPlayer | null, CategoryAnalyticsPlayer | null];
  sets: Array<{ p1: number; p2: number }>;
  setsResult: { p1Sets: number; p2Sets: number } | null;
  winnerIndex: 0 | 1 | null;
}

export interface CategoryPerformanceSummary {
  categoryId: number;
  categoryName: string;
  performance: {
    pointsWon: number;
    pointsPlayed: number;
    ratio: number | null;
    setsUsed: number;
    ignoredSets: number;
    matchesConsidered: number;
  };
}

export interface CategoryClassificationSummary {
  categoryId: number;
  categoryName: string;
  position: number | null;
  reason: string;
  mode: "grupo_unico" | "eliminatoria" | "indefinido";
  tieTechnical: boolean;
}

export interface CategoryMedalExpectation {
  mode: "grupo_unico" | "eliminatoria" | "indefinido";
  participantCount: number;
  publishedMatchesCount: number;
  expectedMedalists: number;
}

type RoundStage = "final" | "semifinal" | "quartas" | "oitavas" | "fase16" | "fase32" | "outro";

type ParsedMatch = {
  p1Key: string;
  p2Key: string;
  winnerKey: string | null;
  walkover: boolean;
  doubleWalkover: boolean;
  setsP1: number;
  setsP2: number;
  pointsP1: number;
  pointsP2: number;
};

type RankingResult = {
  orderedKeys: string[];
  tieTechnical: boolean;
};

type StatLine = {
  wins: number;
  losses: number;
  setsWon: number;
  setsLost: number;
  pointsWon: number;
  pointsLost: number;
};

function toRoundStage(round: string | null): RoundStage {
  const normalized = normalizeAthleteName(round ?? "");
  if (!normalized) {
    return "outro";
  }
  if (normalized.includes("semi")) {
    return "semifinal";
  }
  if (normalized.includes("quart")) {
    return "quartas";
  }
  if (normalized.includes("oitav")) {
    return "oitavas";
  }
  if (/\b1 16\b/.test(normalized) || normalized.includes("fase 16") || normalized.includes("fase16")) {
    return "fase16";
  }
  if (/\b1 32\b/.test(normalized) || normalized.includes("fase 32") || normalized.includes("fase32")) {
    return "fase32";
  }
  if (normalized === "final" || /\bfinal\b/.test(normalized)) {
    return "final";
  }
  return "outro";
}

function isGroupRoundMatch(match: CategoryAnalyticsMatch): boolean {
  const normalizedRound = normalizeAthleteName(match.round ?? "");
  const normalizedPhase = String(match.phase ?? "").toUpperCase();
  return (
    normalizedPhase === "GRUPOS" ||
    normalizedRound.includes("grupo") ||
    normalizedRound.includes("unica")
  );
}

function extractGroupKeyFromRound(round: string | null): string {
  const normalized = normalizeAthleteName(round ?? "");
  if (!normalized) {
    return "grupo";
  }

  if (normalized.includes("grupo unico")) {
    return "grupo-unico";
  }
  if (normalized.includes("unica")) {
    return "grupo-unico";
  }

  const numbered = normalized.match(/grupo\s*0*(\d+)/);
  if (numbered?.[1]) {
    return `grupo-${Number(numbered[1])}`;
  }

  if (normalized.includes("grupo")) {
    return "grupo";
  }

  return normalized;
}

function inferSetsResult(match: CategoryAnalyticsMatch): { p1Sets: number; p2Sets: number } | null {
  if (match.setsResult) {
    return match.setsResult;
  }

  if (match.sets.length === 0) {
    return null;
  }

  let p1Sets = 0;
  let p2Sets = 0;
  for (const set of match.sets) {
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

export function isWalkoverMatch(match: CategoryAnalyticsMatch): boolean {
  const setsResult = inferSetsResult(match);
  return detectWalkover({
    sets: match.sets,
    p1Sets: setsResult?.p1Sets ?? null,
    p2Sets: setsResult?.p2Sets ?? null,
    scoreRaw: match.scoreRaw ?? null,
  }).isWalkover;
}

export function collectWalkoverLoserAthleteIds(matches: CategoryAnalyticsMatch[]): Set<number> {
  const loserIds = new Set<number>();
  for (const match of matches) {
    if (!isWalkoverMatch(match)) {
      continue;
    }

    const detection = detectWalkover({
      sets: match.sets,
      p1Sets: match.setsResult?.p1Sets ?? null,
      p2Sets: match.setsResult?.p2Sets ?? null,
      scoreRaw: match.scoreRaw ?? null,
    });
    const isDoubleWalkover = detection.isDoubleWalkover;
    if (isDoubleWalkover) {
      for (const player of match.players) {
        const athleteId = player?.athleteId ?? null;
        if (typeof athleteId === "number" && athleteId > 0) {
          loserIds.add(athleteId);
        }
      }
      continue;
    }

    const loserIndex = match.winnerIndex === 0 ? 1 : 0;
    const loserId = match.players[loserIndex]?.athleteId ?? null;
    if (typeof loserId === "number" && loserId > 0) {
      loserIds.add(loserId);
    }
  }
  return loserIds;
}

function toStandingKey(player: CategoryAnalyticsPlayer | null, fallbackIndex: number): string {
  if (player?.athleteId) {
    return `id:${player.athleteId}`;
  }
  const normalizedName = normalizeStandingNameKey(player?.name ?? "");
  return normalizedName ? `name:${normalizedName}` : `unk:${fallbackIndex}`;
}

function splitCompositeEntryParts(name: string | null | undefined): string[] {
  return compactWhitespace(name)
    .split(/\s+#\s+|#|\s+-\s+/g)
    .map((part) => compactWhitespace(part))
    .filter(Boolean);
}

function normalizeStandingNameKey(name: string | null | undefined): string {
  const parts = splitCompositeEntryParts(name);
  if (parts.length >= 2) {
    const deduped = new Set<string>();
    for (const part of parts) {
      const normalizedPart = normalizeAthleteName(part);
      if (normalizedPart) {
        deduped.add(normalizedPart);
      }
    }
    if (deduped.size >= 2) {
      return [...deduped].sort((left, right) => left.localeCompare(right, "pt-BR")).join("#");
    }
  }
  return normalizeAthleteName(name ?? "");
}

function areStandingMemberNamesEquivalent(left: string | null | undefined, right: string | null | undefined): boolean {
  const leftKey = normalizeAthleteName(left ?? "");
  const rightKey = normalizeAthleteName(right ?? "");
  if (!leftKey || !rightKey) {
    return false;
  }
  return leftKey === rightKey || leftKey.includes(rightKey) || rightKey.includes(leftKey);
}

function areStandingEntryNamesEquivalent(left: string | null | undefined, right: string | null | undefined): boolean {
  const leftParts = splitCompositeEntryParts(left);
  const rightParts = splitCompositeEntryParts(right);

  if (leftParts.length >= 2 || rightParts.length >= 2) {
    if (leftParts.length < 2 || rightParts.length < 2) {
      return false;
    }
    const remaining = [...rightParts];
    for (const leftPart of leftParts) {
      const matchIndex = remaining.findIndex((rightPart) => areStandingMemberNamesEquivalent(leftPart, rightPart));
      if (matchIndex === -1) {
        return false;
      }
      remaining.splice(matchIndex, 1);
    }
    return remaining.length === 0;
  }

  return areStandingMemberNamesEquivalent(left, right);
}

function athleteMatchesStandingKey(
  key: string,
  athlete: AthletePerformanceInput,
  candidateName?: string | null,
): boolean {
  if (key.startsWith("id:")) {
    const athleteId = Number(key.slice(3));
    if (!Number.isFinite(athleteId)) {
      return false;
    }
    if (typeof athlete.athleteId === "number" && athlete.athleteId === athleteId) {
      return true;
    }
    if ((athlete.athleteIds ?? []).some((id) => id === athleteId)) {
      return true;
    }
    return candidateName ? areStandingEntryNamesEquivalent(athlete.athleteName ?? athlete.athleteNameNormalized ?? "", candidateName) : false;
  }

  if (key.startsWith("name:")) {
    const athleteName = athlete.athleteName ?? athlete.athleteNameNormalized ?? "";
    const normalizedName = normalizeStandingNameKey(athleteName);
    if (key === `name:${normalizedName}`) {
      return true;
    }

    const candidateName = key
      .slice(5)
      .split("#")
      .map((part) => compactWhitespace(part))
      .filter(Boolean)
      .join(" # ");
    return areStandingEntryNamesEquivalent(athleteName, candidateName);
  }

  return false;
}

function stableHash(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return Math.abs(hash >>> 0);
}

function toParsedMatch(match: CategoryAnalyticsMatch): ParsedMatch {
  const p1Key = toStandingKey(match.players[0], 0);
  const p2Key = toStandingKey(match.players[1], 1);
  const winnerKey = match.winnerIndex === 0 ? p1Key : match.winnerIndex === 1 ? p2Key : null;
  const walkoverDetection = detectWalkover({
    sets: match.sets,
    p1Sets: match.setsResult?.p1Sets ?? null,
    p2Sets: match.setsResult?.p2Sets ?? null,
    scoreRaw: match.scoreRaw ?? null,
  });
  const walkover = walkoverDetection.isWalkover;

  const setsResult = inferSetsResult(match);
  const setsP1 = setsResult?.p1Sets ?? 0;
  const setsP2 = setsResult?.p2Sets ?? 0;

  let pointsP1 = 0;
  let pointsP2 = 0;
  for (const set of match.sets) {
    const p1 = Number(set.p1);
    const p2 = Number(set.p2);
    if (!Number.isFinite(p1) || !Number.isFinite(p2)) {
      continue;
    }
    if (p1 < 0 || p2 < 0) {
      continue;
    }
    pointsP1 += p1;
    pointsP2 += p2;
  }

  return {
    p1Key,
    p2Key,
    winnerKey,
    walkover,
    doubleWalkover: walkoverDetection.isDoubleWalkover,
    setsP1,
    setsP2,
    pointsP1,
    pointsP2,
  };
}

function collectGroupWalkoverLoserKeys(input: {
  matches: CategoryAnalyticsMatch[];
  parsedMatches: ParsedMatch[];
}): Set<string> {
  const losers = new Set<string>();

  input.matches.forEach((match, index) => {
    if (!isGroupRoundMatch(match)) {
      return;
    }
    const parsed = input.parsedMatches[index];
    if (!parsed || !parsed.walkover) {
      return;
    }

    if (parsed.doubleWalkover) {
      losers.add(parsed.p1Key);
      losers.add(parsed.p2Key);
      return;
    }

    if (parsed.winnerKey === parsed.p1Key) {
      losers.add(parsed.p2Key);
      return;
    }
    if (parsed.winnerKey === parsed.p2Key) {
      losers.add(parsed.p1Key);
      return;
    }

    losers.add(parsed.p1Key);
    losers.add(parsed.p2Key);
  });

  return losers;
}

function buildStatLine(keys: string[], parsedMatches: ParsedMatch[]): Map<string, StatLine> {
  const keySet = new Set(keys);
  const stats = new Map<string, StatLine>(
    keys.map((key) => [
      key,
      {
        wins: 0,
        losses: 0,
        setsWon: 0,
        setsLost: 0,
        pointsWon: 0,
        pointsLost: 0,
      },
    ]),
  );

  for (const match of parsedMatches) {
    if (!keySet.has(match.p1Key) || !keySet.has(match.p2Key)) {
      continue;
    }

    const p1 = stats.get(match.p1Key);
    const p2 = stats.get(match.p2Key);
    if (!p1 || !p2) {
      continue;
    }

    if (match.winnerKey === match.p1Key) {
      p1.wins += 1;
      p2.losses += 1;
    } else if (match.winnerKey === match.p2Key) {
      p2.wins += 1;
      p1.losses += 1;
    }

    // WO nao contabiliza sets/pontos como disputados na carreira.
    if (!match.walkover) {
      p1.setsWon += match.setsP1;
      p1.setsLost += match.setsP2;
      p2.setsWon += match.setsP2;
      p2.setsLost += match.setsP1;

      p1.pointsWon += match.pointsP1;
      p1.pointsLost += match.pointsP2;
      p2.pointsWon += match.pointsP2;
      p2.pointsLost += match.pointsP1;
    }
  }

  return stats;
}

function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0;
  }
  return numerator / denominator;
}

function almostEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-12;
}

function deterministicDraw(keys: string[], seed: string): string[] {
  return [...keys].sort((left, right) => {
    const hashLeft = stableHash(`${seed}|${left}`);
    const hashRight = stableHash(`${seed}|${right}`);
    if (hashLeft !== hashRight) {
      return hashLeft - hashRight;
    }
    return left.localeCompare(right);
  });
}

function resolveDirectHeadToHead(keys: [string, string], parsedMatches: ParsedMatch[]): string[] | null {
  let leftWins = 0;
  let rightWins = 0;

  for (const match of parsedMatches) {
    const involvesPair =
      (match.p1Key === keys[0] && match.p2Key === keys[1]) ||
      (match.p1Key === keys[1] && match.p2Key === keys[0]);
    if (!involvesPair) {
      continue;
    }

    if (match.winnerKey === keys[0]) {
      leftWins += 1;
    } else if (match.winnerKey === keys[1]) {
      rightWins += 1;
    }
  }

  if (leftWins === rightWins) {
    return null;
  }
  return leftWins > rightWins ? [keys[0], keys[1]] : [keys[1], keys[0]];
}

function rankTiedGroupRecursively(input: {
  keys: string[];
  parsedMatches: ParsedMatch[];
  seed: string;
}): RankingResult {
  const uniqueKeys = [...new Set(input.keys)];
  if (uniqueKeys.length <= 1) {
    return { orderedKeys: uniqueKeys, tieTechnical: false };
  }

  const relevantMatches = input.parsedMatches.filter(
    (match) => uniqueKeys.includes(match.p1Key) && uniqueKeys.includes(match.p2Key),
  );

  if (uniqueKeys.length === 2) {
    const direct = resolveDirectHeadToHead([uniqueKeys[0], uniqueKeys[1]], relevantMatches);
    if (direct) {
      return { orderedKeys: direct, tieTechnical: false };
    }

    return {
      orderedKeys: deterministicDraw(uniqueKeys, `${input.seed}|draw-2`),
      tieTechnical: true,
    };
  }

  const criteria: Array<{ name: string; metric: (line: StatLine) => number }> = [
    {
      name: "razao_partidas",
      metric: (line) => ratio(line.wins, line.wins + line.losses),
    },
    {
      name: "razao_sets",
      metric: (line) => ratio(line.setsWon, line.setsWon + line.setsLost),
    },
    {
      name: "razao_pontos",
      metric: (line) => ratio(line.pointsWon, line.pointsWon + line.pointsLost),
    },
  ];

  for (const criterion of criteria) {
    const stats = buildStatLine(uniqueKeys, relevantMatches);
    const sorted = [...uniqueKeys].sort((left, right) => {
      const leftLine = stats.get(left);
      const rightLine = stats.get(right);
      const leftScore = leftLine ? criterion.metric(leftLine) : 0;
      const rightScore = rightLine ? criterion.metric(rightLine) : 0;
      if (!almostEqual(leftScore, rightScore)) {
        return rightScore - leftScore;
      }
      return left.localeCompare(right);
    });

    const groups: string[][] = [];
    for (const key of sorted) {
      const line = stats.get(key);
      const score = line ? criterion.metric(line) : 0;
      const last = groups[groups.length - 1];
      if (!last) {
        groups.push([key]);
        continue;
      }

      const lastLine = stats.get(last[0]);
      const lastScore = lastLine ? criterion.metric(lastLine) : 0;
      if (almostEqual(lastScore, score)) {
        last.push(key);
      } else {
        groups.push([key]);
      }
    }

    if (groups.length === 1 && groups[0].length === uniqueKeys.length) {
      continue;
    }

    let tieTechnical = false;
    const resolved: string[] = [];
    for (const group of groups) {
      if (group.length === 1) {
        resolved.push(group[0]);
        continue;
      }
      const recursive = rankTiedGroupRecursively({
        keys: group,
        parsedMatches: relevantMatches,
        seed: `${input.seed}|${criterion.name}|${group.join("|")}`,
      });
      resolved.push(...recursive.orderedKeys);
      tieTechnical = tieTechnical || recursive.tieTechnical;
    }

    return {
      orderedKeys: resolved,
      tieTechnical,
    };
  }

  return {
    orderedKeys: deterministicDraw(uniqueKeys, `${input.seed}|draw-final`),
    tieTechnical: true,
  };
}

function computeGroupSingleClassification(input: {
  categoryId: number;
  categoryName: string;
  matches: CategoryAnalyticsMatch[];
  athlete: AthletePerformanceInput;
}): { position: number | null; reason: string; tieTechnical: boolean } {
  const parsedMatches = input.matches.map(toParsedMatch);
  const hasDecisiveResult = parsedMatches.some((match) => match.winnerKey !== null);
  if (!hasDecisiveResult) {
    return {
      position: null,
      reason: "grupo_sem_resultados_publicados",
      tieTechnical: true,
    };
  }

  const allKeys = [...new Set(parsedMatches.flatMap((match) => [match.p1Key, match.p2Key]))];
  const displayNameByKey = new Map<string, string>();
  parsedMatches.forEach((match, index) => {
    displayNameByKey.set(match.p1Key, input.matches[index]?.players[0]?.name ?? "");
    displayNameByKey.set(match.p2Key, input.matches[index]?.players[1]?.name ?? "");
  });

  const ordered = rankTiedGroupRecursively({
    keys: allKeys,
    parsedMatches,
    seed: `group:${input.categoryId}:${normalizeAthleteName(input.categoryName)}`,
  });

  const athleteIds = new Set<number>();
  if (typeof input.athlete.athleteId === "number") {
    athleteIds.add(input.athlete.athleteId);
  }
  for (const id of input.athlete.athleteIds ?? []) {
    if (typeof id === "number") {
      athleteIds.add(id);
    }
  }
  const normalizedName = normalizeStandingNameKey(input.athlete.athleteName ?? input.athlete.athleteNameNormalized ?? "");

  const athleteIndex = ordered.orderedKeys.findIndex((key) => {
    if (key.startsWith("id:")) {
      return athleteMatchesStandingKey(key, input.athlete, displayNameByKey.get(key) ?? null);
    }
    if (key.startsWith("name:")) {
      return key === `name:${normalizedName}` || athleteMatchesStandingKey(key, input.athlete, displayNameByKey.get(key) ?? null);
    }
    return false;
  });

  if (athleteIndex < 0) {
    return {
      position: null,
      reason: "atleta_nao_encontrado_no_grupo_unico",
      tieTechnical: false,
    };
  }

  return {
    position: athleteIndex + 1,
    reason: "classificacao_por_confronto_direto_razoes_partidas_sets_pontos_sorteio",
    tieTechnical: ordered.tieTechnical,
  };
}

function computeEliminationClassification(
  matches: CategoryAnalyticsMatch[],
  athlete: AthletePerformanceInput,
): { position: number | null; reason: string; tieTechnical: boolean } {
  let hasEliminationRound = false;
  let hasEliminationParticipation = false;
  let hasGroupMatch = false;
  let lostSemi = false;
  let lostQuartas = false;
  let lostOitavas = false;
  let lostFase16 = false;
  let lostFase32 = false;
  let wonFinal = false;
  let lostFinal = false;

  for (const match of matches) {
    const stage = toRoundStage(match.round);
    if (isGroupRoundMatch(match)) {
      hasGroupMatch = true;
    }
    if (stage === "outro") {
      continue;
    }
    hasEliminationRound = true;

    const athleteIndex = resolveAthleteIndexInMatch(
      {
        players: [
          { athleteId: match.players[0]?.athleteId ?? null, name: match.players[0]?.name ?? null },
          { athleteId: match.players[1]?.athleteId ?? null, name: match.players[1]?.name ?? null },
        ],
        sets: match.sets,
        winnerIndex: match.winnerIndex,
      },
      athlete,
    );
    if (athleteIndex === null || (match.winnerIndex !== 0 && match.winnerIndex !== 1)) {
      continue;
    }
    hasEliminationParticipation = true;

    const isWin = athleteIndex === match.winnerIndex;
    const isLoss = !isWin;

    if (stage === "final" && isWin) {
      wonFinal = true;
    } else if (stage === "final" && isLoss) {
      lostFinal = true;
    } else if (stage === "semifinal" && isLoss) {
      lostSemi = true;
    } else if (stage === "quartas" && isLoss) {
      lostQuartas = true;
    } else if (stage === "oitavas" && isLoss) {
      lostOitavas = true;
    } else if (stage === "fase16" && isLoss) {
      lostFase16 = true;
    } else if (stage === "fase32" && isLoss) {
      lostFase32 = true;
    }
  }

  if (wonFinal) {
    return { position: 1, reason: "campeao_venceu_final", tieTechnical: false };
  }
  if (lostFinal) {
    return { position: 2, reason: "vice_perdeu_final", tieTechnical: false };
  }
  if (lostSemi) {
    return { position: 3, reason: "perdeu_semifinal", tieTechnical: false };
  }
  if (lostQuartas) {
    return { position: 5, reason: "perdeu_quartas", tieTechnical: false };
  }
  if (lostOitavas) {
    return { position: 9, reason: "perdeu_oitavas", tieTechnical: false };
  }
  if (lostFase16) {
    return { position: 17, reason: "perdeu_fase_16", tieTechnical: false };
  }
  if (lostFase32) {
    return { position: 33, reason: "perdeu_fase_32", tieTechnical: false };
  }
  if (!hasEliminationParticipation && hasGroupMatch) {
    return { position: 33, reason: "nao_classificado_fase_de_grupos", tieTechnical: false };
  }
  if (!hasEliminationRound) {
    return { position: null, reason: "sem_dados_de_eliminatoria", tieTechnical: false };
  }

  return { position: null, reason: "eliminatoria_incompleta_para_classificacao", tieTechnical: false };
}

export function computeCategoryPerformanceSummaries(
  matches: CategoryAnalyticsMatch[],
  athlete: AthletePerformanceInput,
): CategoryPerformanceSummary[] {
  const byCategory = new Map<number, CategoryAnalyticsMatch[]>();
  for (const match of matches) {
    const bucket = byCategory.get(match.categoryId) ?? [];
    bucket.push(match);
    byCategory.set(match.categoryId, bucket);
  }

  return [...byCategory.entries()]
    .map(([categoryId, categoryMatches]) => {
      const first = categoryMatches[0];
      const performance = calculateAthletePointPerformance(
        categoryMatches.map((item) => ({
          players: [
            { athleteId: item.players[0]?.athleteId ?? null, name: item.players[0]?.name ?? null },
            { athleteId: item.players[1]?.athleteId ?? null, name: item.players[1]?.name ?? null },
          ],
          sets: item.sets,
          winnerIndex: item.winnerIndex,
        })),
        athlete,
      );

      return {
        categoryId,
        categoryName: first.categoryName,
        performance,
      };
    })
    .sort((a, b) => a.categoryName.localeCompare(b.categoryName, "pt-BR", { sensitivity: "base" }));
}

export function computeCategoryClassificationSummaries(
  matches: CategoryAnalyticsMatch[],
  athlete: AthletePerformanceInput,
): CategoryClassificationSummary[] {
  const byCategory = new Map<number, CategoryAnalyticsMatch[]>();
  for (const match of matches) {
    const bucket = byCategory.get(match.categoryId) ?? [];
    bucket.push(match);
    byCategory.set(match.categoryId, bucket);
  }

  return [...byCategory.entries()]
    .map(([categoryId, categoryMatches]) => {
      const first = categoryMatches[0];
      const parsedCategoryMatches = categoryMatches.map(toParsedMatch);
      const structuralParticipants = new Set<string>();
      const structuralGroupRounds = new Set<string>();
      let hasEliminationStructure = false;
      for (const match of categoryMatches) {
        structuralParticipants.add(toStandingKey(match.players[0], 0));
        structuralParticipants.add(toStandingKey(match.players[1], 1));
        if (isGroupRoundMatch(match)) {
          structuralGroupRounds.add(extractGroupKeyFromRound(match.round));
          continue;
        }
        const roundStage = toRoundStage(match.round);
        const hasRealPlayers = Boolean(
          match.players[0]?.name ||
            match.players[0]?.athleteId ||
            match.players[1]?.name ||
            match.players[1]?.athleteId,
        );
        if (roundStage !== "outro" && hasRealPlayers) {
          hasEliminationStructure = true;
        }
      }

      const walkoverLosersInGroups = collectGroupWalkoverLoserKeys({
        matches: categoryMatches,
        parsedMatches: parsedCategoryMatches,
      });

      const effectiveCategoryMatches = categoryMatches.filter((match, index) => {
        if (!isGroupRoundMatch(match)) {
          return true;
        }
        const parsed = parsedCategoryMatches[index];
        if (!parsed) {
          return true;
        }
        return !walkoverLosersInGroups.has(parsed.p1Key) && !walkoverLosersInGroups.has(parsed.p2Key);
      });
      const effectiveParsedMatches = effectiveCategoryMatches.map(toParsedMatch);
      const displayNameByKey = new Map<string, string>();
      categoryMatches.forEach((match) => {
        displayNameByKey.set(toStandingKey(match.players[0], 0), match.players[0]?.name ?? "");
        displayNameByKey.set(toStandingKey(match.players[1], 1), match.players[1]?.name ?? "");
      });

      const hasAnyMatch = effectiveParsedMatches.length > 0;
      const hasPendingMatches = effectiveParsedMatches.some((match) => match.winnerKey === null);
      const hasAnyDecisiveResult = effectiveParsedMatches.some((match) => match.winnerKey !== null);
      if (!hasAnyMatch) {
        const participantKeys = new Set<string>();
        for (const parsed of parsedCategoryMatches) {
          participantKeys.add(parsed.p1Key);
          participantKeys.add(parsed.p2Key);
        }
        const eligibleKeys = [...participantKeys].filter((key) => !walkoverLosersInGroups.has(key));
        if (
          eligibleKeys.length === 1 &&
          athleteMatchesStandingKey(eligibleKeys[0], athlete, displayNameByKey.get(eligibleKeys[0]) ?? null)
        ) {
          return {
            categoryId,
            categoryName: first.categoryName,
            position: 1,
            reason: "campeao_por_comparecimento_apos_wo",
            mode: "grupo_unico",
            tieTechnical: false,
          } satisfies CategoryClassificationSummary;
        }

        return {
          categoryId,
          categoryName: first.categoryName,
          position: null,
          reason: "sem_confrontos_publicados",
          mode: "indefinido",
          tieTechnical: false,
        } satisfies CategoryClassificationSummary;
      }

      const participants = new Set<string>();
      let hasDecisiveEliminationData = false;

      for (const match of effectiveCategoryMatches) {
        const groupMatch = isGroupRoundMatch(match);
        participants.add(toStandingKey(match.players[0], 0));
        participants.add(toStandingKey(match.players[1], 1));
        if (!groupMatch) {
          const roundStage = toRoundStage(match.round);
          const hasRealPlayers = Boolean(
            match.players[0]?.name ||
              match.players[0]?.athleteId ||
              match.players[1]?.name ||
              match.players[1]?.athleteId,
          );
          if (roundStage !== "outro" && hasRealPlayers && match.winnerIndex !== null) {
            hasDecisiveEliminationData = true;
          }
        }
      }

      const hasGroupData = structuralGroupRounds.size > 0;
      const isSingleGroup =
        hasGroupData &&
        ((structuralGroupRounds.size === 1 && !hasEliminationStructure) ||
          (structuralParticipants.size > 0 && structuralParticipants.size <= 5 && !hasEliminationStructure));
      if (!isSingleGroup && hasPendingMatches && !hasDecisiveEliminationData) {
        return {
          categoryId,
          categoryName: first.categoryName,
          position: null,
          reason: "classificacao_final_pendente_confrontos_nao_finalizados",
          mode: "indefinido",
          tieTechnical: !hasAnyDecisiveResult,
        } satisfies CategoryClassificationSummary;
      }

      const decisiveMatches = isSingleGroup
        ? effectiveCategoryMatches.filter((_, index) => effectiveParsedMatches[index]?.winnerKey !== null)
        : effectiveCategoryMatches;
      const result = isSingleGroup
        ? computeGroupSingleClassification({
            categoryId,
            categoryName: first.categoryName,
            matches: decisiveMatches,
            athlete,
          })
        : computeEliminationClassification(decisiveMatches, athlete);

      return {
        categoryId,
        categoryName: first.categoryName,
        position: result.position,
        reason: result.reason,
        mode: isSingleGroup ? "grupo_unico" : result.position === null ? "indefinido" : "eliminatoria",
        tieTechnical: result.tieTechnical,
      } satisfies CategoryClassificationSummary;
    })
    .sort((a, b) => a.categoryName.localeCompare(b.categoryName, "pt-BR", { sensitivity: "base" }));
}

export function inferCategoryMedalExpectation(matches: CategoryAnalyticsMatch[]): CategoryMedalExpectation | null {
  if (matches.length === 0) {
    return null;
  }

  const parsedCategoryMatches = matches.map(toParsedMatch);
  const structuralParticipants = new Set<string>();
  const structuralGroupRounds = new Set<string>();
  let hasEliminationStructure = false;
  for (const match of matches) {
    structuralParticipants.add(toStandingKey(match.players[0], 0));
    structuralParticipants.add(toStandingKey(match.players[1], 1));
    if (isGroupRoundMatch(match)) {
      structuralGroupRounds.add(extractGroupKeyFromRound(match.round));
      continue;
    }
    const roundStage = toRoundStage(match.round);
    const hasRealPlayers = Boolean(
      match.players[0]?.name ||
        match.players[0]?.athleteId ||
        match.players[1]?.name ||
        match.players[1]?.athleteId,
    );
    if (roundStage !== "outro" && hasRealPlayers) {
      hasEliminationStructure = true;
    }
  }

  const walkoverLosersInGroups = collectGroupWalkoverLoserKeys({
    matches,
    parsedMatches: parsedCategoryMatches,
  });

  const effectiveMatches = matches.filter((match, index) => {
    if (!isGroupRoundMatch(match)) {
      return true;
    }
    const parsed = parsedCategoryMatches[index];
    if (!parsed) {
      return true;
    }
    return !walkoverLosersInGroups.has(parsed.p1Key) && !walkoverLosersInGroups.has(parsed.p2Key);
  });

  if (effectiveMatches.length === 0) {
    return {
      mode: "indefinido",
      participantCount: 0,
      publishedMatchesCount: 0,
      expectedMedalists: 0,
    };
  }

  const effectiveParticipants = new Set<string>();
  for (const match of effectiveMatches) {
    effectiveParticipants.add(toStandingKey(match.players[0], 0));
    effectiveParticipants.add(toStandingKey(match.players[1], 1));
  }

  const hasGroupData = structuralGroupRounds.size > 0;
  const isSingleGroup =
    hasGroupData &&
    ((structuralGroupRounds.size === 1 && !hasEliminationStructure) ||
      (structuralParticipants.size > 0 && structuralParticipants.size <= 5 && !hasEliminationStructure));

  const participantCount = effectiveParticipants.size;
  const expectedMedalists = Math.min(participantCount, 4);

  return {
    mode: isSingleGroup ? "grupo_unico" : "eliminatoria",
    participantCount,
    publishedMatchesCount: effectiveMatches.length,
    expectedMedalists,
  };
}
