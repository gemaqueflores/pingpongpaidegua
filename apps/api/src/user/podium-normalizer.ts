export type MedalType = "ouro" | "prata" | "bronze";

export type MedalistLike = {
  athleteId: number;
  athleteName: string;
  medalha: MedalType;
  position: number;
  unitKey?: string | null;
};

const MAX_BY_MEDAL: Record<MedalType, number> = {
  ouro: 1,
  prata: 1,
  bronze: 2,
};

const MEDAL_ORDER: MedalType[] = ["ouro", "prata", "bronze"];

function normalizeToken(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitCompositeParts(name: string): string[] {
  return name
    .split(/\s+#\s+|#|\s+-\s+/g)
    .map((part) => normalizeToken(part))
    .filter(Boolean)
    .sort();
}

function areNamesEquivalent(left: string, right: string): boolean {
  const leftParts = splitCompositeParts(left);
  const rightParts = splitCompositeParts(right);
  if (leftParts.length > 1 || rightParts.length > 1) {
    if (leftParts.length !== rightParts.length || leftParts.length === 0) {
      return false;
    }
    return leftParts.every((leftPart) =>
      rightParts.some(
        (rightPart) =>
          rightPart === leftPart ||
          rightPart.includes(leftPart) ||
          leftPart.includes(rightPart),
      ),
    );
  }

  const leftToken = normalizeToken(left);
  const rightToken = normalizeToken(right);
  return (
    leftToken === rightToken ||
    leftToken.includes(rightToken) ||
    rightToken.includes(leftToken)
  );
}

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

  const selectedUnitKeys = new Set<string>();
  const selectedNamesByMedal: Record<MedalType, string[]> = {
    ouro: [],
    prata: [],
    bronze: [],
  };
  const normalized: T[] = [];
  for (const medal of MEDAL_ORDER) {
    let selectedForMedal = 0;
    for (const candidate of byMedal[medal]) {
      const unitKey = candidate.unitKey?.trim() || `athlete:${candidate.athleteId}`;
      if (selectedForMedal >= MAX_BY_MEDAL[medal]) {
        break;
      }
      if (selectedUnitKeys.has(unitKey)) {
        continue;
      }
      if (selectedNamesByMedal[medal].some((name) => areNamesEquivalent(name, candidate.athleteName))) {
        continue;
      }
      normalized.push(candidate);
      selectedUnitKeys.add(unitKey);
      selectedNamesByMedal[medal].push(candidate.athleteName);
      selectedForMedal += 1;
    }
  }

  return normalized;
}
