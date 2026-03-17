import { EventLevel } from "@prisma/client";
import { ParsedCategory, ParsedDataset, ParsedMatch, ParsedRegistration, normalizeText } from "@cbtm/shared";

export interface DatasetScopeStats {
  enabled: boolean;
  reason: string;
  eligibleClubsCount: number;
  eligibleCategoriesCount: number;
  registrationsBefore: number;
  registrationsAfter: number;
  matchesBefore: number;
  matchesAfter: number;
  categoriesBefore: number;
  categoriesAfter: number;
}

function buildParsedCategoryKey(input: {
  categoryId: string | null | undefined;
  categoryNormalizedName: string | null | undefined;
  categoryName: string | null | undefined;
}): string | null {
  const categoryId = String(input.categoryId ?? "").trim();
  if (categoryId) {
    return `id:${categoryId}`;
  }
  const normalized =
    normalizeText(input.categoryNormalizedName) || normalizeText(input.categoryName) || null;
  if (!normalized) {
    return null;
  }
  return `name:${normalized}`;
}

function selectCategoryKeysFromRegistrations(
  registrations: ParsedRegistration[],
  eligibleClubNames: Set<string>,
): Set<string> {
  const eligibleAthleteNames = new Set(
    registrations
      .filter((registration) =>
        eligibleClubNames.has(normalizeText(registration.clubNormalizedName || registration.clubName)),
      )
      .map((registration) => normalizeText(registration.athleteNormalizedName || registration.athleteName))
      .filter(Boolean),
  );

  const eligibleCategoryKeys = new Set<string>();
  for (const registration of registrations) {
    const athleteName = normalizeText(registration.athleteNormalizedName || registration.athleteName);
    const clubName = normalizeText(registration.clubNormalizedName || registration.clubName);
    const isEligible =
      (athleteName && eligibleAthleteNames.has(athleteName)) ||
      (clubName && eligibleClubNames.has(clubName));
    if (!isEligible) {
      continue;
    }
    const key = buildParsedCategoryKey({
      categoryId: registration.categoryId ?? null,
      categoryNormalizedName: registration.categoryNormalizedName ?? null,
      categoryName: registration.categoryName ?? null,
    });
    if (key) {
      eligibleCategoryKeys.add(key);
    }
  }

  return eligibleCategoryKeys;
}

function extendCategoryKeysFromMatches(
  matches: ParsedMatch[],
  eligibleClubNames: Set<string>,
  eligibleCategoryKeys: Set<string>,
  eligibleAthleteNames: Set<string>,
): void {
  for (const match of matches) {
    const athleteAName = normalizeText(match.athleteANormalizedName || match.athleteAName);
    const athleteBName = normalizeText(match.athleteBNormalizedName || match.athleteBName);
    const athleteClubA = normalizeText(match.athleteAClubNormalizedName ?? "");
    const athleteClubB = normalizeText(match.athleteBClubNormalizedName ?? "");
    const byAthlete = eligibleAthleteNames.has(athleteAName) || eligibleAthleteNames.has(athleteBName);
    const byClub =
      (athleteClubA && eligibleClubNames.has(athleteClubA)) ||
      (athleteClubB && eligibleClubNames.has(athleteClubB));
    if (!Boolean(byAthlete || byClub)) {
      continue;
    }
    const key = buildParsedCategoryKey({
      categoryId: match.categoryId ?? null,
      categoryNormalizedName: match.categoryNormalizedName ?? null,
      categoryName: match.categoryName ?? null,
    });
    if (key) {
      eligibleCategoryKeys.add(key);
    }
  }
}

function filterByEligibleCategoryKeys<T extends ParsedRegistration | ParsedMatch | ParsedCategory>(
  items: T[],
  mapper: (item: T) => { categoryId?: string | null; categoryNormalizedName?: string | null; categoryName?: string | null },
  eligibleCategoryKeys: Set<string>,
): T[] {
  return items.filter((item) => {
    const { categoryId, categoryNormalizedName, categoryName } = mapper(item);
    const key = buildParsedCategoryKey({
      categoryId: categoryId ?? null,
      categoryNormalizedName: categoryNormalizedName ?? null,
      categoryName: categoryName ?? null,
    });
    return Boolean(key && eligibleCategoryKeys.has(key));
  });
}

export function shouldApplyParenseScope(
  eventLevel: EventLevel | null,
  eventName: string | null,
): boolean {
  if (eventLevel === "COPA" || eventLevel === "NACIONAL") {
    return true;
  }
  const normalizedName = normalizeText(String(eventName ?? ""));
  return normalizedName.includes("brasileirao") || normalizedName.includes("copa");
}

export function applyParenseEligibilityScopeToDataset(input: {
  eventLevel: EventLevel | null;
  eventName: string | null;
  dataset: ParsedDataset;
  eligibleClubNames: Set<string>;
  warnings: string[];
}): { dataset: ParsedDataset; stats: DatasetScopeStats } {
  const enabled = shouldApplyParenseScope(input.eventLevel, input.eventName);
  const baseStats: DatasetScopeStats = {
    enabled,
    reason: enabled ? "evento_copa_ou_nacional" : "nao_aplicavel",
    eligibleClubsCount: 0,
    eligibleCategoriesCount: 0,
    registrationsBefore: input.dataset.registrations.length,
    registrationsAfter: input.dataset.registrations.length,
    matchesBefore: input.dataset.matches.length,
    matchesAfter: input.dataset.matches.length,
    categoriesBefore: input.dataset.categories.length,
    categoriesAfter: input.dataset.categories.length,
  };

  if (!enabled) {
    return { dataset: input.dataset, stats: baseStats };
  }

  if (input.eligibleClubNames.size === 0) {
    input.warnings.push(
      "ESCOPO_PARAOPEBA: sem clubes elegiveis (ESTADUAL/OPEN) encontrados; filtro ignorado.",
    );
    return {
      dataset: input.dataset,
      stats: {
        ...baseStats,
        reason: "sem_clubes_elegiveis",
      },
    };
  }

  const eligibleAthleteNames = new Set(
    input.dataset.registrations
      .filter((registration) =>
        input.eligibleClubNames.has(normalizeText(registration.clubNormalizedName || registration.clubName)),
      )
      .map((registration) => normalizeText(registration.athleteNormalizedName || registration.athleteName))
      .filter(Boolean),
  );

  const eligibleCategoryKeys = selectCategoryKeysFromRegistrations(
    input.dataset.registrations,
    input.eligibleClubNames,
  );
  extendCategoryKeysFromMatches(
    input.dataset.matches,
    input.eligibleClubNames,
    eligibleCategoryKeys,
    eligibleAthleteNames,
  );

  if (eligibleCategoryKeys.size === 0) {
    input.warnings.push(
      "ESCOPO_PARAOPEBA: nenhuma categoria elegivel identificada no payload; filtro ignorado para evitar perda de integridade.",
    );
    return {
      dataset: input.dataset,
      stats: {
        ...baseStats,
        reason: "sem_categorias_elegiveis",
        eligibleClubsCount: input.eligibleClubNames.size,
      },
    };
  }

  const scopedRegistrations = filterByEligibleCategoryKeys(
    input.dataset.registrations,
    (item) => item,
    eligibleCategoryKeys,
  );
  const scopedMatches = filterByEligibleCategoryKeys(
    input.dataset.matches,
    (item) => item,
    eligibleCategoryKeys,
  );
  const scopedCategories = filterByEligibleCategoryKeys(
    input.dataset.categories,
    (item) => item,
    eligibleCategoryKeys,
  );

  if (input.dataset.matches.length > 0 && scopedMatches.length === 0) {
    input.warnings.push(
      "ESCOPO_PARAOPEBA: filtro por categoria elegivel resultou em 0 confrontos; filtro ignorado para preservar integridade.",
    );
    return {
      dataset: input.dataset,
      stats: {
        ...baseStats,
        reason: "fallback_integridade_zero_confrontos",
        eligibleClubsCount: input.eligibleClubNames.size,
        eligibleCategoriesCount: eligibleCategoryKeys.size,
      },
    };
  }

  const matchRetentionRatio =
    input.dataset.matches.length > 0 ? scopedMatches.length / input.dataset.matches.length : 1;
  if (input.dataset.matches.length >= 100 && matchRetentionRatio < 0.05) {
    input.warnings.push(
      `ESCOPO_PARAOPEBA: recorte extremo de confrontos (${scopedMatches.length}/${input.dataset.matches.length}); filtro ignorado para preservar integridade.`,
    );
    return {
      dataset: input.dataset,
      stats: {
        ...baseStats,
        reason: "fallback_integridade_queda_extrema",
        eligibleClubsCount: input.eligibleClubNames.size,
        eligibleCategoriesCount: eligibleCategoryKeys.size,
      },
    };
  }

  input.warnings.push(
    `ESCOPO_PARAOPEBA: filtro por categoria elegivel aplicado para ${input.eventLevel ?? "NIVEL_DESCONHECIDO"}; clubes elegiveis=${input.eligibleClubNames.size}; categorias elegiveis=${eligibleCategoryKeys.size}; registros ${input.dataset.registrations.length}->${scopedRegistrations.length}; jogos ${input.dataset.matches.length}->${scopedMatches.length}; categorias ${input.dataset.categories.length}->${scopedCategories.length}.`,
  );

  return {
    dataset: {
      ...input.dataset,
      categories: scopedCategories,
      registrations: scopedRegistrations,
      matches: scopedMatches,
    },
    stats: {
      ...baseStats,
      reason: "filtro_aplicado",
      eligibleClubsCount: input.eligibleClubNames.size,
      eligibleCategoriesCount: eligibleCategoryKeys.size,
      registrationsAfter: scopedRegistrations.length,
      matchesAfter: scopedMatches.length,
      categoriesAfter: scopedCategories.length,
    },
  };
}
