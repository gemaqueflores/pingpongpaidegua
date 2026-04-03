import { EventSituation } from "@cbtm/shared";

const MUTABLE_REGISTRATION_SITUATIONS: EventSituation[] = [
  "PRE_INSCRICOES",
  "INSCRICOES_ABERTAS",
  "POS_INSCRICOES_PRE_EVENTO",
  "GRADES_PUBLICADAS_PRE_JOGO",
  "EM_ANDAMENTO",
];

export function shouldSyncRegistrationSnapshot(input: {
  eventConcluded: boolean;
  eventSituation: EventSituation;
  registrationCount: number;
}): boolean {
  if (input.eventConcluded) {
    return false;
  }
  if (input.registrationCount <= 0) {
    return false;
  }
  return MUTABLE_REGISTRATION_SITUATIONS.includes(input.eventSituation);
}

export function computeRegistrationCategoryRemovals(input: {
  currentCategoryIds: number[];
  observedCategoryIds: Set<number>;
  protectedCategoryIds?: Set<number>;
}): number[] {
  const removals: number[] = [];
  const protectedIds = input.protectedCategoryIds ?? new Set<number>();

  for (const categoryId of input.currentCategoryIds) {
    if (protectedIds.has(categoryId)) {
      continue;
    }
    if (!input.observedCategoryIds.has(categoryId)) {
      removals.push(categoryId);
    }
  }

  return removals;
}

export interface RegistrationCategoryPair {
  athleteId: number;
  categoryId: number;
  registrationStatus: "INSCRITO" | "PRE_INSCRITO" | "OUTRO" | null;
}

export function detectRegistrationCategoryMerge(input: {
  missingCategoryId: number;
  currentPairs: RegistrationCategoryPair[];
  observedPairs: Iterable<RegistrationCategoryPair>;
}): {
  merged: boolean;
  migratedAthleteCount: number;
  totalAthleteCount: number;
  targetCategoryIds: number[];
} {
  const totalAthleteCount = input.currentPairs.length;
  if (totalAthleteCount === 0) {
    return {
      merged: false,
      migratedAthleteCount: 0,
      totalAthleteCount: 0,
      targetCategoryIds: [],
    };
  }

  const sourceAthleteIds = new Set(input.currentPairs.map((pair) => pair.athleteId));
  const migratedAthletes = new Set<number>();
  const targetCategoryIds = new Set<number>();

  for (const pair of input.observedPairs) {
    if (!sourceAthleteIds.has(pair.athleteId)) {
      continue;
    }
    if (pair.categoryId === input.missingCategoryId) {
      continue;
    }

    migratedAthletes.add(pair.athleteId);
    targetCategoryIds.add(pair.categoryId);
  }

  return {
    merged: migratedAthletes.size === totalAthleteCount,
    migratedAthleteCount: migratedAthletes.size,
    totalAthleteCount,
    targetCategoryIds: [...targetCategoryIds].sort((a, b) => a - b),
  };
}

export function detectRegistrationCategoryCancellation(input: {
  missingCategoryId: number;
  currentPairs: RegistrationCategoryPair[];
  observedPairs: Iterable<RegistrationCategoryPair>;
  maxEntrants: number;
}): {
  cancelled: boolean;
  stillVisibleAthleteCount: number;
  totalAthleteCount: number;
} {
  const totalAthleteCount = input.currentPairs.length;
  if (totalAthleteCount === 0 || input.maxEntrants <= 0 || totalAthleteCount > input.maxEntrants) {
    return {
      cancelled: false,
      stillVisibleAthleteCount: 0,
      totalAthleteCount,
    };
  }

  const sourceAthleteIds = new Set(input.currentPairs.map((pair) => pair.athleteId));
  const stillVisibleAthletes = new Set<number>();

  for (const pair of input.observedPairs) {
    if (!sourceAthleteIds.has(pair.athleteId)) {
      continue;
    }
    if (pair.categoryId === input.missingCategoryId) {
      continue;
    }
    stillVisibleAthletes.add(pair.athleteId);
  }

  return {
    cancelled: stillVisibleAthletes.size === 0,
    stillVisibleAthleteCount: stillVisibleAthletes.size,
    totalAthleteCount,
  };
}

export function computeEventRegistrationPairRemovals(input: {
  currentPairs: RegistrationCategoryPair[];
  observedPairKeys: Set<string>;
  protectedCategoryIds?: Set<number>;
}): RegistrationCategoryPair[] {
  const protectedIds = input.protectedCategoryIds ?? new Set<number>();
  const removals: RegistrationCategoryPair[] = [];

  for (const pair of input.currentPairs) {
    if (protectedIds.has(pair.categoryId)) {
      continue;
    }

    const key = `${pair.athleteId}|${pair.categoryId}`;
    if (!input.observedPairKeys.has(key)) {
      removals.push(pair);
    }
  }

  return removals;
}

export function shouldAllowDestructiveRegistrationSync(input: {
  existingPairCount: number;
  observedPairCount: number;
  projectedRemovalCount?: number;
  minExistingPairCount?: number;
  minCoverageRatio?: number;
  maxRemovalRatio?: number;
}): {
  allow: boolean;
  reason: "ok" | "low-coverage" | "high-removal-ratio";
  coverageRatio: number;
  removalRatio: number | null;
} {
  const existing = Math.max(0, Math.trunc(input.existingPairCount));
  const observed = Math.max(0, Math.trunc(input.observedPairCount));
  const minExistingPairCount = input.minExistingPairCount ?? 80;
  const minCoverageRatio = input.minCoverageRatio ?? 0.65;
  const maxRemovalRatio = input.maxRemovalRatio ?? 0.45;
  const coverageRatio = existing === 0 ? 1 : observed / existing;

  if (existing >= minExistingPairCount && coverageRatio < minCoverageRatio) {
    return {
      allow: false,
      reason: "low-coverage",
      coverageRatio,
      removalRatio: null,
    };
  }

  const projectedRemovalCount =
    input.projectedRemovalCount === undefined ? null : Math.max(0, Math.trunc(input.projectedRemovalCount));
  const removalRatio =
    projectedRemovalCount === null || existing === 0 ? null : projectedRemovalCount / existing;

  if (existing >= minExistingPairCount && removalRatio !== null && removalRatio > maxRemovalRatio) {
    return {
      allow: false,
      reason: "high-removal-ratio",
      coverageRatio,
      removalRatio,
    };
  }

  return {
    allow: true,
    reason: "ok",
    coverageRatio,
    removalRatio,
  };
}
