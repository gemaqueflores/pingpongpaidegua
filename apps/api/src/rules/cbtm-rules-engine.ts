import { normalizeAthleteName } from "@cbtm/shared";
import {
  type CbtmEventType,
  type RatingDeltaBucket,
  type RankingStage,
  loadCbtmRulesConfig,
} from "./cbtm-config-loader";

export type RulesAthleteInput = {
  athleteId: number;
  name: string;
  clubName?: string | null;
  seed: number;
};

export type RulesGroup = {
  groupName: string;
  athletes: RulesAthleteInput[];
};

export type AllocationTraceItem = {
  athleteId: number;
  athleteName: string;
  seed: number;
  groupName: string;
  round: number;
  direction: "forward" | "backward";
  source: "cobra" | "swap";
  reason?: string;
};

export type RulesMatchInput = {
  athleteAId: number;
  athleteBId: number;
  winnerId: number | null;
  setsA: number;
  setsB: number;
  pointsA: number;
  pointsB: number;
};

export type RulesStanding = {
  athleteId: number;
  wins: number;
  losses: number;
  sets_won: number;
  sets_lost: number;
  points_won: number;
  points_lost: number;
};

export type TieBreakTrace = {
  criteria: "head_to_head" | "ratio_matches" | "ratio_sets" | "ratio_points" | "draw";
  athleteIds: number[];
  values: Array<{ athleteId: number; value: number | null }>;
  note?: string;
};

export type GroupTableOutput = {
  standings: RulesStanding[];
  tiebreakTrace: TieBreakTrace[];
};

function stableHash(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return Math.abs(hash >>> 0);
}

function ratio(a: number, b: number): number {
  if (b <= 0) {
    return 0;
  }
  return a / b;
}

function almostEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-12;
}

function toClubKey(athlete: RulesAthleteInput): string {
  const club = normalizeAthleteName(athlete.clubName ?? "");
  return club || "sem-clube";
}

function scoreGroupViolation(group: RulesGroup): number {
  const byClub = new Map<string, number>();
  for (const athlete of group.athletes) {
    const key = toClubKey(athlete);
    byClub.set(key, (byClub.get(key) ?? 0) + 1);
  }

  let score = 0;
  for (const count of byClub.values()) {
    if (group.athletes.length <= 3 && count >= 2) {
      score += count - 1;
    }
    if (group.athletes.length >= 4 && count >= 3) {
      score += count - 2;
    }
  }
  return score;
}

function totalViolation(groups: RulesGroup[]): number {
  return groups.reduce((sum, group) => sum + scoreGroupViolation(group), 0);
}

export function allocateGroupsCobra(input: {
  athletesSorted: RulesAthleteInput[];
  groupSizes: number[];
  applyClubRemanejamento?: boolean;
}): { groups: RulesGroup[]; allocationTrace: AllocationTraceItem[]; warnings: string[] } {
  const warnings: string[] = [];
  const groupCount = input.groupSizes.length;
  if (groupCount <= 0) {
    return { groups: [], allocationTrace: [], warnings: ["Nenhum grupo definido para alocação COBRA."] };
  }

  const groups: RulesGroup[] = Array.from({ length: groupCount }, (_, idx) => ({
    groupName: groupCount === 1 ? "Único" : `Grupo ${String(idx + 1).padStart(2, "0")}`,
    athletes: [],
  }));
  const trace: AllocationTraceItem[] = [];

  const remaining = [...input.groupSizes];
  let athleteIndex = 0;
  let cursor = 0;
  while (athleteIndex < input.athletesSorted.length) {
    const round = Math.floor(cursor / groupCount) + 1;
    const offset = cursor % groupCount;
    const direction: "forward" | "backward" = round % 2 === 1 ? "forward" : "backward";
    const groupIndex = direction === "forward" ? offset : groupCount - 1 - offset;
    cursor += 1;

    if ((remaining[groupIndex] ?? 0) <= 0) {
      continue;
    }

    const athlete = input.athletesSorted[athleteIndex];
    athleteIndex += 1;
    remaining[groupIndex] -= 1;
    groups[groupIndex].athletes.push(athlete);
    trace.push({
      athleteId: athlete.athleteId,
      athleteName: athlete.name,
      seed: athlete.seed,
      groupName: groups[groupIndex].groupName,
      round,
      direction,
      source: "cobra",
    });
  }

  if (athleteIndex < input.athletesSorted.length) {
    warnings.push("Atletas excedentes não foram alocados por falta de vaga em groupSizes.");
  }

  if (input.applyClubRemanejamento !== false) {
    let improved = true;
    while (improved) {
      improved = false;
      const before = totalViolation(groups);
      if (before <= 0) {
        break;
      }

      let bestSwap:
        | {
            leftGroup: number;
            leftIndex: number;
            rightGroup: number;
            rightIndex: number;
            improvement: number;
            seedDistance: number;
          }
        | null = null;

      for (let g1 = 0; g1 < groups.length; g1 += 1) {
        for (let g2 = g1 + 1; g2 < groups.length; g2 += 1) {
          for (let i = 0; i < groups[g1].athletes.length; i += 1) {
            for (let j = 0; j < groups[g2].athletes.length; j += 1) {
              const leftAthlete = groups[g1].athletes[i];
              const rightAthlete = groups[g2].athletes[j];

              const next = groups.map((group) => ({ groupName: group.groupName, athletes: [...group.athletes] }));
              next[g1].athletes[i] = rightAthlete;
              next[g2].athletes[j] = leftAthlete;

              const after = totalViolation(next);
              const improvement = before - after;
              if (improvement <= 0) {
                continue;
              }

              const seedDistance = Math.abs(leftAthlete.seed - rightAthlete.seed);
              if (
                !bestSwap ||
                improvement > bestSwap.improvement ||
                (improvement === bestSwap.improvement && seedDistance < bestSwap.seedDistance)
              ) {
                bestSwap = { leftGroup: g1, leftIndex: i, rightGroup: g2, rightIndex: j, improvement, seedDistance };
              }
            }
          }
        }
      }

      if (bestSwap) {
        const left = groups[bestSwap.leftGroup].athletes[bestSwap.leftIndex];
        const right = groups[bestSwap.rightGroup].athletes[bestSwap.rightIndex];
        groups[bestSwap.leftGroup].athletes[bestSwap.leftIndex] = right;
        groups[bestSwap.rightGroup].athletes[bestSwap.rightIndex] = left;
        trace.push({
          athleteId: left.athleteId,
          athleteName: left.name,
          seed: left.seed,
          groupName: groups[bestSwap.rightGroup].groupName,
          round: 0,
          direction: "forward",
          source: "swap",
          reason: `Remanejamento por clube com melhoria ${bestSwap.improvement}`,
        });
        trace.push({
          athleteId: right.athleteId,
          athleteName: right.name,
          seed: right.seed,
          groupName: groups[bestSwap.leftGroup].groupName,
          round: 0,
          direction: "forward",
          source: "swap",
          reason: `Remanejamento por clube com melhoria ${bestSwap.improvement}`,
        });
        improved = true;
      }
    }

    if (totalViolation(groups) > 0) {
      warnings.push("Não foi possível eliminar todas as colisões de clube com remanejamento determinístico.");
    }
  }

  return {
    groups,
    allocationTrace: trace,
    warnings,
  };
}

export function scheduleGroupMatches(input: {
  group: RulesGroup;
  forceSameClubFirst?: boolean;
}): Array<{ athleteAId: number; athleteBId: number }> {
  const pairs: Array<{ athleteAId: number; athleteBId: number; sameClub: boolean }> = [];
  const athletes = input.group.athletes;
  for (let i = 0; i < athletes.length; i += 1) {
    for (let j = i + 1; j < athletes.length; j += 1) {
      pairs.push({
        athleteAId: athletes[i].athleteId,
        athleteBId: athletes[j].athleteId,
        sameClub: toClubKey(athletes[i]) === toClubKey(athletes[j]),
      });
    }
  }

  if (input.forceSameClubFirst !== false) {
    pairs.sort((a, b) => Number(b.sameClub) - Number(a.sameClub));
  }

  return pairs.map((item) => ({ athleteAId: item.athleteAId, athleteBId: item.athleteBId }));
}

function standingsFromMatches(athleteIds: number[], matches: RulesMatchInput[]): Map<number, RulesStanding> {
  const map = new Map<number, RulesStanding>(
    athleteIds.map((id) => [
      id,
      {
        athleteId: id,
        wins: 0,
        losses: 0,
        sets_won: 0,
        sets_lost: 0,
        points_won: 0,
        points_lost: 0,
      },
    ]),
  );

  const athleteSet = new Set(athleteIds);
  for (const match of matches) {
    if (!athleteSet.has(match.athleteAId) || !athleteSet.has(match.athleteBId)) {
      continue;
    }

    const a = map.get(match.athleteAId);
    const b = map.get(match.athleteBId);
    if (!a || !b) {
      continue;
    }

    if (match.winnerId === match.athleteAId) {
      a.wins += 1;
      b.losses += 1;
    } else if (match.winnerId === match.athleteBId) {
      b.wins += 1;
      a.losses += 1;
    }

    a.sets_won += match.setsA;
    a.sets_lost += match.setsB;
    b.sets_won += match.setsB;
    b.sets_lost += match.setsA;

    a.points_won += match.pointsA;
    a.points_lost += match.pointsB;
    b.points_won += match.pointsB;
    b.points_lost += match.pointsA;
  }

  return map;
}

function deterministicSort(ids: number[], seed: string): number[] {
  return [...ids].sort((left, right) => {
    const leftHash = stableHash(`${seed}|${left}`);
    const rightHash = stableHash(`${seed}|${right}`);
    if (leftHash !== rightHash) {
      return leftHash - rightHash;
    }
    return left - right;
  });
}

export function resolveTies(input: {
  athleteIds: number[];
  matches: RulesMatchInput[];
  seed: string;
}): { orderedAthleteIds: number[]; trace: TieBreakTrace[]; tieTechnical: boolean } {
  const trace: TieBreakTrace[] = [];

  const recurse = (ids: number[], seed: string): { order: number[]; tieTechnical: boolean } => {
    if (ids.length <= 1) {
      return { order: ids, tieTechnical: false };
    }

    const relevantMatches = input.matches.filter(
      (match) => ids.includes(match.athleteAId) && ids.includes(match.athleteBId),
    );

    if (ids.length === 2) {
      let leftWins = 0;
      let rightWins = 0;
      for (const match of relevantMatches) {
        if (match.winnerId === ids[0]) leftWins += 1;
        if (match.winnerId === ids[1]) rightWins += 1;
      }
      trace.push({
        criteria: "head_to_head",
        athleteIds: [...ids],
        values: [
          { athleteId: ids[0], value: leftWins },
          { athleteId: ids[1], value: rightWins },
        ],
      });
      if (leftWins !== rightWins) {
        return { order: leftWins > rightWins ? ids : [ids[1], ids[0]], tieTechnical: false };
      }

      trace.push({
        criteria: "draw",
        athleteIds: [...ids],
        values: ids.map((id) => ({ athleteId: id, value: null })),
        note: "Empate persistente em confronto direto; sorteio determinístico aplicado.",
      });
      return { order: deterministicSort(ids, `${seed}|draw-2`), tieTechnical: true };
    }

    const criteria: Array<{
      key: TieBreakTrace["criteria"];
      value: (line: RulesStanding) => number;
    }> = [
      { key: "ratio_matches", value: (line) => ratio(line.wins, line.wins + line.losses) },
      { key: "ratio_sets", value: (line) => ratio(line.sets_won, line.sets_won + line.sets_lost) },
      { key: "ratio_points", value: (line) => ratio(line.points_won, line.points_won + line.points_lost) },
    ];

    for (const criterion of criteria) {
      const statMap = standingsFromMatches(ids, relevantMatches);
      const scored = ids.map((id) => ({ athleteId: id, score: criterion.value(statMap.get(id) ?? {
        athleteId: id,
        wins: 0,
        losses: 0,
        sets_won: 0,
        sets_lost: 0,
        points_won: 0,
        points_lost: 0,
      }) }));
      trace.push({
        criteria: criterion.key,
        athleteIds: [...ids],
        values: scored.map((item) => ({ athleteId: item.athleteId, value: item.score })),
      });

      const sorted = [...scored].sort((a, b) => {
        if (!almostEqual(a.score, b.score)) {
          return b.score - a.score;
        }
        return a.athleteId - b.athleteId;
      });

      const groups: number[][] = [];
      for (const item of sorted) {
        const last = groups[groups.length - 1];
        if (!last) {
          groups.push([item.athleteId]);
          continue;
        }
        const lastScore = sorted.find((candidate) => candidate.athleteId === last[0])?.score ?? 0;
        if (almostEqual(lastScore, item.score)) {
          last.push(item.athleteId);
        } else {
          groups.push([item.athleteId]);
        }
      }

      if (groups.length === 1 && groups[0].length === ids.length) {
        continue;
      }

      let tieTechnical = false;
      const merged: number[] = [];
      for (const group of groups) {
        if (group.length === 1) {
          merged.push(group[0]);
          continue;
        }
        const recursive = recurse(group, `${seed}|${criterion.key}|${group.join("-")}`);
        merged.push(...recursive.order);
        tieTechnical = tieTechnical || recursive.tieTechnical;
      }
      return { order: merged, tieTechnical };
    }

    trace.push({
      criteria: "draw",
      athleteIds: [...ids],
      values: ids.map((id) => ({ athleteId: id, value: null })),
      note: "Empate absoluto após razões; sorteio determinístico aplicado.",
    });
    return { order: deterministicSort(ids, `${seed}|draw-final`), tieTechnical: true };
  };

  const result = recurse([...new Set(input.athleteIds)], input.seed);
  return {
    orderedAthleteIds: result.order,
    trace,
    tieTechnical: result.tieTechnical,
  };
}

export function computeGroupTable(input: {
  athleteIds: number[];
  matches: RulesMatchInput[];
  seed: string;
}): GroupTableOutput {
  const standingsMap = standingsFromMatches(input.athleteIds, input.matches);
  const tie = resolveTies({ athleteIds: input.athleteIds, matches: input.matches, seed: input.seed });
  const standings = tie.orderedAthleteIds.map((id) => standingsMap.get(id)).filter((value): value is RulesStanding => Boolean(value));
  return {
    standings,
    tiebreakTrace: tie.trace,
  };
}

export function computeRankingPoints(input: {
  eventType: CbtmEventType;
  finalStage: RankingStage;
}): number {
  const config = loadCbtmRulesConfig();
  return config.rankingPointsTable[input.eventType][input.finalStage] ?? 0;
}

function findDeltaBucket(delta: number, buckets: RatingDeltaBucket[]): RatingDeltaBucket {
  const row = buckets.find((item) => delta >= item.delta_min && delta <= item.delta_max);
  if (!row) {
    throw new Error(`Sem bucket de rating para delta=${delta}. Verifique rating_basic_delta_table.json.`);
  }
  return row;
}

export function computeRatingDelta(input: {
  ratingA: number;
  ratingB: number;
  winner: "A" | "B";
  eventType: CbtmEventType;
}): {
  deltaA: number;
  deltaB: number;
  trace: {
    delta: number;
    eventWeight: number;
    baseA: number;
    baseB: number;
    caseA: "expected_win" | "expected_loss" | "unexpected_win" | "unexpected_loss";
    caseB: "expected_win" | "expected_loss" | "unexpected_win" | "unexpected_loss";
  };
} {
  const config = loadCbtmRulesConfig();
  const delta = Math.abs(input.ratingA - input.ratingB);
  const bucket = findDeltaBucket(delta, config.ratingBasicDeltaTable);
  const eventWeight = config.ratingEventWeights[input.eventType];

  const aIsFavorite = input.ratingA >= input.ratingB;
  const aWon = input.winner === "A";

  const caseA: "expected_win" | "expected_loss" | "unexpected_win" | "unexpected_loss" = aIsFavorite
    ? aWon
      ? "expected_win"
      : "expected_loss"
    : aWon
    ? "unexpected_win"
    : "unexpected_loss";

  const caseB: "expected_win" | "expected_loss" | "unexpected_win" | "unexpected_loss" = aIsFavorite
    ? aWon
      ? "unexpected_loss"
      : "unexpected_win"
    : aWon
    ? "expected_loss"
    : "expected_win";

  const baseA = bucket[caseA] ?? 0;
  const baseB = bucket[caseB] ?? -baseA;

  return {
    deltaA: baseA * eventWeight,
    deltaB: baseB * eventWeight,
    trace: {
      delta,
      eventWeight,
      baseA,
      baseB,
      caseA,
      caseB,
    },
  };
}
