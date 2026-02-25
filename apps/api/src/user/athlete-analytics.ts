import {
  AthletePerformanceInput,
  calculateAthletePointPerformance,
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

type RoundStage = "final" | "semifinal" | "quartas" | "oitavas" | "fase16" | "fase32" | "outro";

type ParsedMatch = {
  p1Key: string;
  p2Key: string;
  winnerKey: string | null;
  walkover: boolean;
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
  const normalizedName = normalizeAthleteName(player?.name ?? "");
  return normalizedName ? `name:${normalizedName}` : `unk:${fallbackIndex}`;
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
  const walkover = isWalkoverMatch(match);

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
    setsP1,
    setsP2,
    pointsP1,
    pointsP2,
  };
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
  const normalizedName = normalizeAthleteName(input.athlete.athleteNameNormalized ?? input.athlete.athleteName ?? "");

  const athleteIndex = ordered.orderedKeys.findIndex((key) => {
    if (key.startsWith("id:")) {
      return athleteIds.has(Number(key.slice(3)));
    }
    if (key.startsWith("name:")) {
      return key === `name:${normalizedName}`;
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
      const hasAnyMatch = parsedCategoryMatches.length > 0;
      const hasPendingMatches = parsedCategoryMatches.some((match) => match.winnerKey === null);
      const hasAnyDecisiveResult = parsedCategoryMatches.some((match) => match.winnerKey !== null);
      if (!hasAnyMatch) {
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
      const groupRounds = new Set<string>();
      let hasDecisiveEliminationData = false;

      for (const match of categoryMatches) {
        const groupMatch = isGroupRoundMatch(match);
        participants.add(toStandingKey(match.players[0], 0));
        participants.add(toStandingKey(match.players[1], 1));
        if (groupMatch) {
          groupRounds.add(extractGroupKeyFromRound(match.round));
        } else {
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

      const hasGroupData = groupRounds.size > 0;
      const isSingleGroup =
        hasGroupData &&
        ((groupRounds.size === 1 && !hasDecisiveEliminationData) ||
          (participants.size > 0 && participants.size <= 5));
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
        ? categoryMatches.filter((_, index) => parsedCategoryMatches[index]?.winnerKey !== null)
        : categoryMatches;
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
