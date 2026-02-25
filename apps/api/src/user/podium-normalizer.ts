export type MedalType = "ouro" | "prata" | "bronze";

export type MedalistLike = {
  athleteId: number;
  athleteName: string;
  medalha: MedalType;
  position: number;
};

const MAX_BY_MEDAL: Record<MedalType, number> = {
  ouro: 1,
  prata: 1,
  bronze: 2,
};

const MEDAL_ORDER: MedalType[] = ["ouro", "prata", "bronze"];

function compareMedalists(left: MedalistLike, right: MedalistLike): number {
  if (left.position !== right.position) {
    return left.position - right.position;
  }
  const byName = left.athleteName.localeCompare(right.athleteName, "pt-BR", { sensitivity: "base" });
  if (byName !== 0) {
    return byName;
  }
  return left.athleteId - right.athleteId;
}

export function normalizeCategoryMedalists<T extends MedalistLike>(medalists: T[]): T[] {
  if (medalists.length <= 1) {
    return [...medalists];
  }

  const byMedal: Record<MedalType, T[]> = {
    ouro: [],
    prata: [],
    bronze: [],
  };
  for (const medalist of medalists) {
    byMedal[medalist.medalha].push(medalist);
  }
  for (const medal of MEDAL_ORDER) {
    byMedal[medal].sort(compareMedalists);
  }

  const selectedAthleteIds = new Set<number>();
  const normalized: T[] = [];
  for (const medal of MEDAL_ORDER) {
    let selectedForMedal = 0;
    for (const candidate of byMedal[medal]) {
      if (selectedForMedal >= MAX_BY_MEDAL[medal]) {
        break;
      }
      if (selectedAthleteIds.has(candidate.athleteId)) {
        continue;
      }
      normalized.push(candidate);
      selectedAthleteIds.add(candidate.athleteId);
      selectedForMedal += 1;
    }
  }

  return normalized;
}

