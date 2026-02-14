import { BRAZIL_STATES_BY_CODE, inferBrazilStateFromClubNameDetailed } from "@cbtm/shared";

export type EventLevelLike = "ESTADUAL" | "COPA" | "NACIONAL" | null | undefined;

export interface AthleteFederation {
  stateCode: string | null;
  stateName: string | null;
  region: string | null;
}

export function shouldInferAthleteFederation(level: EventLevelLike): boolean {
  return level === "COPA" || level === "NACIONAL";
}

export function inferAthleteFederationFromClub(input: {
  eventLevel: EventLevelLike;
  clubName: string | null | undefined;
  current?: AthleteFederation | null;
}): {
  next: AthleteFederation | null;
  source?: "suffix" | "club_exception";
  warning?: "missing_pattern_or_invalid_uf";
} {
  if (!shouldInferAthleteFederation(input.eventLevel)) {
    return { next: null };
  }

  const detailed = inferBrazilStateFromClubNameDetailed(input.clubName);
  if (!detailed) {
    return { next: null, warning: "missing_pattern_or_invalid_uf" };
  }
  const inferred = detailed.state;

  const currentCode = String(input.current?.stateCode ?? "").toUpperCase();
  const hasCurrentValid =
    Boolean(currentCode) &&
    Boolean(input.current?.stateName) &&
    Boolean(input.current?.region) &&
    Boolean(BRAZIL_STATES_BY_CODE[currentCode]);

  if (hasCurrentValid) {
    return {
      next: {
        stateCode: currentCode,
        stateName: input.current?.stateName ?? inferred.name,
        region: input.current?.region ?? inferred.region,
      },
      source: detailed.source,
    };
  }

  return {
    next: {
      stateCode: inferred.code,
      stateName: inferred.name,
      region: inferred.region,
    },
    source: detailed.source,
  };
}
