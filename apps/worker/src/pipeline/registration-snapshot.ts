import { EventSituation } from "@cbtm/shared";

const MUTABLE_REGISTRATION_SITUATIONS: EventSituation[] = [
  "PRE_INSCRICOES",
  "INSCRICOES_ABERTAS",
  "POS_INSCRICOES_PRE_EVENTO",
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

export function computeEventRegistrationPairRemovals(input: {
  currentPairs: RegistrationCategoryPair[];
  observedPairKeys: Set<string>;
  protectedCategoryIds?: Set<number>;
}): RegistrationCategoryPair[] {
  const protectedIds = input.protectedCategoryIds ?? new Set<number>();
  const removals: RegistrationCategoryPair[] = [];

  for (const pair of input.currentPairs) {
    if (pair.registrationStatus === null) {
      continue;
    }
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
