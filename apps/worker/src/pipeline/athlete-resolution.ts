import { AthleteResolverCandidate } from "@cbtm/shared";

export interface ResolverCandidateAthlete {
  id: number;
  eventId: number;
  nameDisplay: string;
  nameNormalized: string;
  rankingPoints: number | null;
  ratingPoints: number | null;
  clubNormalizedName: string | null;
  createdFromWarning: boolean;
  aliases: Set<string>;
}

export function buildResolverCandidates(input: {
  eventId: number;
  athletesById: Map<number, ResolverCandidateAthlete>;
  categoryAthleteIds?: Set<number> | null;
}): AthleteResolverCandidate[] {
  const { eventId, athletesById, categoryAthleteIds } = input;
  if (!categoryAthleteIds || categoryAthleteIds.size === 0) {
    return [];
  }

  const candidates: AthleteResolverCandidate[] = [];
  for (const athlete of athletesById.values()) {
    if (athlete.eventId !== eventId || athlete.createdFromWarning) {
      continue;
    }
    if (!categoryAthleteIds.has(athlete.id)) {
      continue;
    }

    candidates.push({
      athleteId: athlete.id,
      eventId: athlete.eventId,
      nameDisplay: athlete.nameDisplay,
      nameNormalized: athlete.nameNormalized,
      rankingPoints: athlete.rankingPoints,
      ratingPoints: athlete.ratingPoints,
      clubNormalizedName: athlete.clubNormalizedName,
      aliasesNormalized: [...athlete.aliases],
    });
  }

  return candidates;
}

export function resolveByCategoryHistory<T extends { id: number }>(
  candidates: T[],
  categoryAliasHistoryCounts: Map<number, number> | null,
): T | null {
  if (!categoryAliasHistoryCounts || candidates.length <= 1) {
    return null;
  }

  const ranked = candidates
    .map((candidate) => ({
      candidate,
      count: categoryAliasHistoryCounts.get(candidate.id) ?? 0,
    }))
    .sort((a, b) => b.count - a.count);

  const top = ranked[0];
  const second = ranked[1];
  if (!top || top.count <= 0) {
    return null;
  }
  if (second && second.count === top.count) {
    return null;
  }

  return top.candidate;
}
