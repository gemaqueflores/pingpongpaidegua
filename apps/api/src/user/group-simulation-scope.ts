import { type RegistrationScope } from "@cbtm/shared";
import { type RegistrationStatus } from "@prisma/client";

export type RegistrationBreakdown = {
  total: number;
  confirmed: number;
  preInscrito: number;
  other: number;
  unknown: number;
};

export type SimulationAthleteInfo = {
  id: number;
  nameDisplay: string;
  clubId: number;
  club: { name: string } | null;
  rankingPoints: number | null;
  ratingPoints: number | null;
};

export type SimulationAthleteLink = {
  registrationStatus: RegistrationStatus | null;
  athlete: SimulationAthleteInfo;
};

export function computeRegistrationBreakdown(rows: SimulationAthleteLink[]): RegistrationBreakdown {
  let confirmed = 0;
  let preInscrito = 0;
  let other = 0;
  let unknown = 0;

  for (const row of rows) {
    if (row.registrationStatus === "INSCRITO") {
      confirmed += 1;
    } else if (row.registrationStatus === "PRE_INSCRITO") {
      preInscrito += 1;
    } else if (row.registrationStatus === "OUTRO") {
      other += 1;
    } else {
      unknown += 1;
    }
  }

  return {
    total: rows.length,
    confirmed,
    preInscrito,
    other,
    unknown,
  };
}

export function selectAthletesByRegistrationScope(
  rows: SimulationAthleteLink[],
  scope: RegistrationScope,
): {
  athletes: SimulationAthleteInfo[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const includeStatus = (status: RegistrationStatus | null): boolean => {
    if (scope === "confirmed_and_pre") {
      return status === "INSCRITO" || status === "PRE_INSCRITO";
    }
    return status === "INSCRITO";
  };

  const selected = rows.filter((row) => includeStatus(row.registrationStatus));
  if (selected.length > 0) {
    return {
      athletes: selected.map((row) => row.athlete),
      warnings,
    };
  }

  if (scope === "confirmed") {
    const unknown = rows.filter((row) => row.registrationStatus === null);
    if (unknown.length > 0) {
      warnings.push(
        `Nenhum inscrito confirmado encontrado; usando ${unknown.length} atleta(s) com status desconhecido (legado).`,
      );
      return {
        athletes: unknown.map((row) => row.athlete),
        warnings,
      };
    }
  }

  return {
    athletes: [],
    warnings,
  };
}

export function hasMinimumSimulationAthletes(count: number): boolean {
  return count >= 3;
}
