import { normalizeAthleteName } from "@cbtm/shared";
import { allocateGroupsCobra } from "../rules/cbtm-rules-engine";

export interface GroupSimulationAthleteInput {
  athleteId: number;
  nameDisplay: string;
  clubId: number | null;
  clubName: string | null;
  rankingPoints: number | null;
  ratingPoints: number | null;
}

export interface GroupSimulationGroup {
  groupName: string;
  athletes: GroupSimulationAthleteInput[];
}

export interface GroupSimulationStats {
  seed: string;
  distributionMode: "ZIGUE_ZAGUE_INVERTIDO";
  sortBasis: "rating" | "ranking";
  primaryFieldUsed: "ratingPoints" | "rankingPoints";
  fallbackUsedCount: number;
  athleteCount: number;
  groupCount: number;
  minGroupSize: number;
  maxGroupSize: number;
  clubCollisionPairs: number;
  clubCollisionsInevitable: number;
  collisionsBefore: number;
  collisionsAfter: number;
  swapsApplied: number;
  iterations: number;
  initialDistribution: Array<{ groupName: string; athleteIds: number[] }>;
  historicalPreferredGroupCount: number | null;
}

export interface GroupSimulationResult {
  groups: GroupSimulationGroup[];
  stats: GroupSimulationStats;
  warnings: string[];
}

type SortBasis = "rating" | "ranking";

type SortResult = {
  sortedAthletes: GroupSimulationAthleteInput[];
  sortBasis: SortBasis;
  primaryFieldUsed: "ratingPoints" | "rankingPoints";
  fallbackUsedCount: number;
};

type SwapCandidate = {
  leftGroupIndex: number;
  leftAthleteIndex: number;
  rightGroupIndex: number;
  rightAthleteIndex: number;
  nextCollisions: number;
  nextStrengthPenalty: number;
};

function buildFallbackGroupSizes(athleteCount: number): number[] {
  if (athleteCount <= 0) {
    return [];
  }

  if (athleteCount <= 5) {
    return [athleteCount];
  }

  if (athleteCount <= 8) {
    if (athleteCount === 6) {
      return [3, 3];
    }
    if (athleteCount === 7) {
      return [3, 4];
    }
    return [4, 4];
  }

  const fullGroupsOfThree = Math.floor(athleteCount / 3);
  const remainder = athleteCount % 3;
  const sizes = Array.from({ length: fullGroupsOfThree }, () => 3);

  if (remainder === 1) {
    // Evita grupo com 1 atleta: converte uma sobra em grupo de 4.
    if (sizes.length > 0) {
      sizes[sizes.length - 1] = 4;
    } else {
      sizes.push(athleteCount);
    }
  } else if (remainder === 2) {
    // Sobra 2 atletas: transforma dois grupos em 4 atletas.
    if (sizes.length >= 2) {
      sizes[sizes.length - 1] = 4;
      sizes[sizes.length - 2] = 4;
    } else if (sizes.length === 1) {
      sizes[0] = 5;
    } else {
      sizes.push(athleteCount);
    }
  }

  return sizes;
}

function normalizeClubKey(athlete: GroupSimulationAthleteInput): string {
  if (athlete.clubId) {
    return `id:${athlete.clubId}`;
  }
  const normalized = normalizeAthleteName(athlete.clubName ?? "");
  return normalized ? `name:${normalized}` : "sem-clube";
}

function resolveSortBasis(categoryName: string | null | undefined): SortBasis {
  const normalized = String(categoryName ?? "").trim();
  return /^r/i.test(normalized) ? "rating" : "ranking";
}

function normalizedNameForSort(name: string): string {
  return normalizeAthleteName(name);
}

export function sortAthletesByScore(
  athletes: GroupSimulationAthleteInput[],
  input: { categoryName?: string | null },
): SortResult {
  const sortBasis = resolveSortBasis(input.categoryName);
  const primaryFieldUsed = sortBasis === "rating" ? "ratingPoints" : "rankingPoints";
  const secondaryFieldUsed = sortBasis === "rating" ? "rankingPoints" : "ratingPoints";

  let fallbackUsedCount = 0;
  const withSortScore = athletes.map((athlete) => {
    const primaryValue = athlete[primaryFieldUsed];
    const secondaryValue = athlete[secondaryFieldUsed];
    const usedFallback = primaryValue === null || primaryValue === undefined;
    if (usedFallback) {
      fallbackUsedCount += 1;
    }

    return {
      athlete,
      primaryValue: primaryValue ?? Number.MIN_SAFE_INTEGER,
      secondaryValue: secondaryValue ?? Number.MIN_SAFE_INTEGER,
      normalizedName: normalizedNameForSort(athlete.nameDisplay),
    };
  });

  withSortScore.sort((left, right) => {
    if (left.primaryValue !== right.primaryValue) {
      return right.primaryValue - left.primaryValue;
    }

    if (left.secondaryValue !== right.secondaryValue) {
      return right.secondaryValue - left.secondaryValue;
    }

    const byName = left.normalizedName.localeCompare(right.normalizedName, "pt-BR", {
      sensitivity: "base",
    });
    if (byName !== 0) {
      return byName;
    }

    return left.athlete.athleteId - right.athlete.athleteId;
  });

  return {
    sortedAthletes: withSortScore.map((item) => item.athlete),
    sortBasis,
    primaryFieldUsed,
    fallbackUsedCount,
  };
}

export function distributeInInvertedSnake(
  sortedAthletes: GroupSimulationAthleteInput[],
  groupSizes: number[],
): GroupSimulationGroup[] {
  const groupCount = groupSizes.length;
  const groups: GroupSimulationGroup[] = Array.from({ length: groupCount }, (_, index) => ({
    groupName: groupCount === 1 ? "Único" : `Grupo ${String(index + 1).padStart(2, "0")}`,
    athletes: [],
  }));

  const totalSlots = groupSizes.reduce((sum, size) => sum + size, 0);
  const remaining = [...groupSizes];
  const placementOrder: number[] = [];
  let cursor = 0;
  let remainingSlots = totalSlots;

  while (remainingSlots > 0) {
    const cycle = Math.floor(cursor / groupCount);
    const offset = cursor % groupCount;
    const groupIndex = cycle % 2 === 0 ? offset : groupCount - 1 - offset;
    if ((remaining[groupIndex] ?? 0) > 0) {
      placementOrder.push(groupIndex);
      remaining[groupIndex] -= 1;
      remainingSlots -= 1;
    }
    cursor += 1;
  }

  if (placementOrder.length !== sortedAthletes.length) {
    throw new Error(
      `Plano de grupos invalido: slots=${placementOrder.length}, atletas=${sortedAthletes.length}.`,
    );
  }

  for (let index = 0; index < sortedAthletes.length; index += 1) {
    const athlete = sortedAthletes[index];
    const groupIndex = placementOrder[index] ?? 0;
    groups[groupIndex].athletes.push(athlete);
  }

  return groups;
}
function copyGroups(groups: GroupSimulationGroup[]): GroupSimulationGroup[] {
  return groups.map((group) => ({
    groupName: group.groupName,
    athletes: [...group.athletes],
  }));
}

function collectAthleteIds(groups: GroupSimulationGroup[]): number[] {
  return groups.flatMap((group) => group.athletes.map((athlete) => athlete.athleteId));
}

function hasSameAthleteSet(leftIds: number[], rightIds: number[]): boolean {
  if (leftIds.length !== rightIds.length) {
    return false;
  }
  const left = [...leftIds].sort((a, b) => a - b);
  const right = [...rightIds].sort((a, b) => a - b);
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

export function countClubCollisions(groups: GroupSimulationGroup[]): number {
  let collisions = 0;
  for (const group of groups) {
    const byClub = new Map<string, number>();
    for (const athlete of group.athletes) {
      const clubKey = normalizeClubKey(athlete);
      byClub.set(clubKey, (byClub.get(clubKey) ?? 0) + 1);
    }

    for (const count of byClub.values()) {
      if (count > 1) {
        collisions += count - 1;
      }
    }
  }
  return collisions;
}

function athleteStrength(athlete: GroupSimulationAthleteInput): number {
  return athlete.ratingPoints ?? athlete.rankingPoints ?? 0;
}

function athleteSortScore(
  athlete: GroupSimulationAthleteInput,
  sortBasis: SortBasis,
): { primary: number; secondary: number; normalizedName: string } {
  const primary = sortBasis === "rating" ? athlete.ratingPoints : athlete.rankingPoints;
  const secondary = sortBasis === "rating" ? athlete.rankingPoints : athlete.ratingPoints;
  return {
    primary: primary ?? Number.MIN_SAFE_INTEGER,
    secondary: secondary ?? Number.MIN_SAFE_INTEGER,
    normalizedName: normalizedNameForSort(athlete.nameDisplay),
  };
}

function sortGroupAthletesByScore(
  groups: GroupSimulationGroup[],
  sortBasis: SortBasis,
): GroupSimulationGroup[] {
  return groups.map((group) => ({
    ...group,
    athletes: [...group.athletes].sort((left, right) => {
      const scoreLeft = athleteSortScore(left, sortBasis);
      const scoreRight = athleteSortScore(right, sortBasis);

      if (scoreLeft.primary !== scoreRight.primary) {
        return scoreRight.primary - scoreLeft.primary;
      }

      if (scoreLeft.secondary !== scoreRight.secondary) {
        return scoreRight.secondary - scoreLeft.secondary;
      }

      const byName = scoreLeft.normalizedName.localeCompare(scoreRight.normalizedName, "pt-BR", {
        sensitivity: "base",
      });
      if (byName !== 0) {
        return byName;
      }

      return left.athleteId - right.athleteId;
    }),
  }));
}

function computeStrengthPenalty(groups: GroupSimulationGroup[]): number {
  if (groups.length === 0) {
    return 0;
  }

  const strengths = groups.map((group) => group.athletes.reduce((sum, athlete) => sum + athleteStrength(athlete), 0));
  const target = strengths.reduce((sum, value) => sum + value, 0) / groups.length;
  return strengths.reduce((sum, value) => sum + Math.abs(value - target), 0);
}

function evaluateSwapDelta(input: {
  groups: GroupSimulationGroup[];
  leftGroupIndex: number;
  leftAthleteIndex: number;
  rightGroupIndex: number;
  rightAthleteIndex: number;
}): { nextCollisions: number; nextStrengthPenalty: number } {
  const groups = copyGroups(input.groups);

  const leftGroup = groups[input.leftGroupIndex];
  const rightGroup = groups[input.rightGroupIndex];
  const leftAthlete = leftGroup.athletes[input.leftAthleteIndex];
  const rightAthlete = rightGroup.athletes[input.rightAthleteIndex];

  leftGroup.athletes[input.leftAthleteIndex] = rightAthlete;
  rightGroup.athletes[input.rightAthleteIndex] = leftAthlete;

  return {
    nextCollisions: countClubCollisions(groups),
    nextStrengthPenalty: computeStrengthPenalty(groups),
  };
}

function applySwap(groups: GroupSimulationGroup[], candidate: SwapCandidate): void {
  const leftGroup = groups[candidate.leftGroupIndex];
  const rightGroup = groups[candidate.rightGroupIndex];
  const leftAthlete = leftGroup.athletes[candidate.leftAthleteIndex];
  const rightAthlete = rightGroup.athletes[candidate.rightAthleteIndex];

  leftGroup.athletes[candidate.leftAthleteIndex] = rightAthlete;
  rightGroup.athletes[candidate.rightAthleteIndex] = leftAthlete;
}

function isBetterCandidate(
  current: SwapCandidate | null,
  next: SwapCandidate,
): boolean {
  if (!current) {
    return true;
  }
  if (next.nextCollisions !== current.nextCollisions) {
    return next.nextCollisions < current.nextCollisions;
  }
  if (next.nextStrengthPenalty !== current.nextStrengthPenalty) {
    return next.nextStrengthPenalty < current.nextStrengthPenalty;
  }

  const currentKey = [
    current.leftGroupIndex,
    current.leftAthleteIndex,
    current.rightGroupIndex,
    current.rightAthleteIndex,
  ].join("|");
  const nextKey = [
    next.leftGroupIndex,
    next.leftAthleteIndex,
    next.rightGroupIndex,
    next.rightAthleteIndex,
  ].join("|");
  return nextKey < currentKey;
}

export function optimizeByClubSwap(input: {
  groups: GroupSimulationGroup[];
  maxIterations: number;
  lockedAthleteIds?: number[];
  maxSwaps?: number;
}): {
  groups: GroupSimulationGroup[];
  collisionsBefore: number;
  collisionsAfter: number;
  swapsApplied: number;
  iterations: number;
} {
  const groups = copyGroups(input.groups);
  const lockedAthleteIds = new Set(input.lockedAthleteIds ?? []);
  let currentCollisions = countClubCollisions(groups);
  let currentStrengthPenalty = computeStrengthPenalty(groups);
  const collisionsBefore = currentCollisions;
  let swapsApplied = 0;
  let iterations = 0;
  const maxSwaps = Math.max(0, input.maxSwaps ?? 1);

  while (iterations < input.maxIterations && swapsApplied < maxSwaps) {
    iterations += 1;
    let bestCandidate: SwapCandidate | null = null;

    for (let leftGroupIndex = 0; leftGroupIndex < groups.length; leftGroupIndex += 1) {
      for (
        let rightGroupIndex = leftGroupIndex + 1;
        rightGroupIndex < groups.length;
        rightGroupIndex += 1
      ) {
        const leftGroup = groups[leftGroupIndex];
        const rightGroup = groups[rightGroupIndex];

        for (let leftAthleteIndex = 0; leftAthleteIndex < leftGroup.athletes.length; leftAthleteIndex += 1) {
          for (
            let rightAthleteIndex = 0;
            rightAthleteIndex < rightGroup.athletes.length;
            rightAthleteIndex += 1
          ) {
            // Mantém a estrutura COBRA por faixas: só permite remanejamento entre slots equivalentes.
            if (leftAthleteIndex !== rightAthleteIndex) {
              continue;
            }
            const leftAthlete = leftGroup.athletes[leftAthleteIndex];
            const rightAthlete = rightGroup.athletes[rightAthleteIndex];
            if (leftAthlete.athleteId === rightAthlete.athleteId) {
              continue;
            }
            if (
              lockedAthleteIds.has(leftAthlete.athleteId) ||
              lockedAthleteIds.has(rightAthlete.athleteId)
            ) {
              continue;
            }

            const evaluated = evaluateSwapDelta({
              groups,
              leftGroupIndex,
              leftAthleteIndex,
              rightGroupIndex,
              rightAthleteIndex,
            });
            if (evaluated.nextCollisions > currentCollisions) {
              continue;
            }

            const improvesObjective = evaluated.nextCollisions < currentCollisions;
            if (!improvesObjective) {
              continue;
            }

            const candidate: SwapCandidate = {
              leftGroupIndex,
              leftAthleteIndex,
              rightGroupIndex,
              rightAthleteIndex,
              nextCollisions: evaluated.nextCollisions,
              nextStrengthPenalty: evaluated.nextStrengthPenalty,
            };

            if (isBetterCandidate(bestCandidate, candidate)) {
              bestCandidate = candidate;
            }
          }
        }
      }
    }

    if (!bestCandidate) {
      break;
    }

    applySwap(groups, bestCandidate);
    currentCollisions = bestCandidate.nextCollisions;
    currentStrengthPenalty = bestCandidate.nextStrengthPenalty;
    swapsApplied += 1;
  }

  return {
    groups,
    collisionsBefore,
    collisionsAfter: currentCollisions,
    swapsApplied,
    iterations,
  };
}

export function simulateGroupsForCategory(input: {
  seed: string;
  athletes: GroupSimulationAthleteInput[];
  categoryName?: string | null;
  preferredGroupCount?: number | null;
}): GroupSimulationResult {
  const warnings: string[] = [];
  const uniqueAthletes = new Map<number, GroupSimulationAthleteInput>();
  let duplicatedAthleteCount = 0;
  for (const athlete of input.athletes) {
    if (uniqueAthletes.has(athlete.athleteId)) {
      duplicatedAthleteCount += 1;
      continue;
    }
    uniqueAthletes.set(athlete.athleteId, athlete);
  }
  const athletes = [...uniqueAthletes.values()];
  if (duplicatedAthleteCount > 0) {
    warnings.push(
      `Simulador descartou ${duplicatedAthleteCount} atleta(s) duplicado(s) pelo mesmo athleteId na entrada da categoria.`,
    );
  }
  const athleteCount = athletes.length;

  if (athleteCount === 0) {
    return {
      groups: [],
      stats: {
        seed: input.seed,
        distributionMode: "ZIGUE_ZAGUE_INVERTIDO",
        sortBasis: "ranking",
        primaryFieldUsed: "rankingPoints",
        fallbackUsedCount: 0,
        athleteCount: 0,
        groupCount: 0,
        minGroupSize: 0,
        maxGroupSize: 0,
        clubCollisionPairs: 0,
        clubCollisionsInevitable: 0,
        collisionsBefore: 0,
        collisionsAfter: 0,
        swapsApplied: 0,
        iterations: 0,
        initialDistribution: [],
        historicalPreferredGroupCount: input.preferredGroupCount ?? null,
      },
      warnings: ["Categoria sem atletas para simulação de grupos."],
    };
  }

  const fallbackGroupSizes = buildFallbackGroupSizes(athleteCount);
  const fallbackGroupCount = fallbackGroupSizes.length;
  const preferredCandidate =
    input.preferredGroupCount && input.preferredGroupCount > 0
      ? Math.min(Math.max(1, input.preferredGroupCount), athleteCount)
      : null;
  const resolvedPreferred = preferredCandidate === fallbackGroupCount ? preferredCandidate : null;

  if (preferredCandidate !== null && resolvedPreferred === null) {
    warnings.push(
      `Preferencia historica de ${preferredCandidate} grupo(s) foi ignorada para respeitar a regra de composicao da categoria (${athleteCount} atletas).`,
    );
  }

  const groupCount = resolvedPreferred ?? fallbackGroupCount;
  const groupSizes = fallbackGroupSizes;
  const maxGroupSize = Math.ceil(athleteCount / groupCount);
  const minGroupSize = Math.floor(athleteCount / groupCount);

  const sortedResult = sortAthletesByScore(athletes, { categoryName: input.categoryName });
  const sortedAthletes = sortedResult.sortedAthletes;
  const cobra = allocateGroupsCobra({
    athletesSorted: sortedAthletes.map((athlete, index) => ({
      athleteId: athlete.athleteId,
      name: athlete.nameDisplay,
      clubName: athlete.clubName,
      seed: index + 1,
    })),
    groupSizes,
    applyClubRemanejamento: false,
  });
  warnings.push(...cobra.warnings);
  const athleteMap = new Map<number, GroupSimulationAthleteInput>(
    sortedAthletes.map((athlete) => [athlete.athleteId, athlete]),
  );
  const initialGroups = cobra.groups.map((group) => ({
    groupName: group.groupName,
    athletes: group.athletes
      .map((athlete) => athleteMap.get(athlete.athleteId))
      .filter((athlete): athlete is GroupSimulationAthleteInput => Boolean(athlete)),
  }));
  const optimized = optimizeByClubSwap({
    groups: initialGroups,
    maxIterations: Math.max(1, athleteCount * groupCount * 2),
    lockedAthleteIds: initialGroups
      .map((group) => group.athletes[0]?.athleteId)
      .filter((athleteId): athleteId is number => Number.isInteger(athleteId)),
  });
  const initialAthleteIds = collectAthleteIds(initialGroups);
  const optimizedAthleteIds = collectAthleteIds(optimized.groups);
  const keepsCategoryAthletes = hasSameAthleteSet(initialAthleteIds, optimizedAthleteIds);
  const unsortedFinalGroups = keepsCategoryAthletes ? optimized.groups : initialGroups;
  const finalGroups = sortGroupAthletesByScore(unsortedFinalGroups, sortedResult.sortBasis);
  const finalCollisions = keepsCategoryAthletes ? optimized.collisionsAfter : optimized.collisionsBefore;
  const finalSwaps = keepsCategoryAthletes ? optimized.swapsApplied : 0;
  const finalIterations = keepsCategoryAthletes ? optimized.iterations : 0;

  if (!keepsCategoryAthletes) {
    warnings.push(
      "Permutas foram descartadas por inconsistir no conjunto de atletas da categoria; mantida distribuicao inicial.",
    );
  }

  if (optimized.collisionsBefore > finalCollisions) {
    warnings.push(
      `Permutas reduziram colisões de clube de ${optimized.collisionsBefore} para ${finalCollisions}.`,
    );
  } else if (finalCollisions > 0) {
    warnings.push(
      `Não foi possível eliminar colisões de clube; permaneceram ${finalCollisions} colisão(ões).`,
    );
  }

  return {
    groups: finalGroups,
    stats: {
      seed: input.seed,
      distributionMode: "ZIGUE_ZAGUE_INVERTIDO",
      sortBasis: sortedResult.sortBasis,
      primaryFieldUsed: sortedResult.primaryFieldUsed,
      fallbackUsedCount: sortedResult.fallbackUsedCount,
      athleteCount,
      groupCount,
      minGroupSize,
      maxGroupSize,
      clubCollisionPairs: finalCollisions,
      clubCollisionsInevitable: finalCollisions,
      collisionsBefore: optimized.collisionsBefore,
      collisionsAfter: finalCollisions,
      swapsApplied: finalSwaps,
      iterations: finalIterations,
      initialDistribution: initialGroups.map((group) => ({
        groupName: group.groupName,
        athleteIds: group.athletes.map((athlete) => athlete.athleteId),
      })),
      historicalPreferredGroupCount: resolvedPreferred,
    },
    warnings,
  };
}





