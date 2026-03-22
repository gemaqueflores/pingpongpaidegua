import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { ParsedMatch } from "@cbtm/shared";
import { UpsertService } from "../src/pipeline/upsert.service";
import { prisma } from "../src/prisma";

function buildMatch(input: Partial<ParsedMatch> & Pick<ParsedMatch, "matchKey" | "categoryId">): ParsedMatch {
  return {
    categoryId: input.categoryId,
    categoryName: input.categoryName ?? `CAT-${input.categoryId}`,
    categoryNormalizedName: input.categoryNormalizedName ?? `cat-${input.categoryId}`,
    phase: input.phase ?? "RESULTADOS",
    round: input.round ?? "Final",
    tableNumber: input.tableNumber ?? null,
    matchDatetime: input.matchDatetime ?? "2026-03-01T10:00:00.000Z",
    athleteAName: input.athleteAName ?? "ATLETA A",
    athleteANormalizedName: input.athleteANormalizedName ?? "atleta a",
    athleteAClubNormalizedName: input.athleteAClubNormalizedName ?? null,
    athleteBName: input.athleteBName ?? "ATLETA B",
    athleteBNormalizedName: input.athleteBNormalizedName ?? "atleta b",
    athleteBClubNormalizedName: input.athleteBClubNormalizedName ?? null,
    scoreRaw: input.scoreRaw ?? "3-1",
    scoreSets: input.scoreSets ?? [],
    setsResult: input.setsResult ?? { p1Sets: 3, p2Sets: 1 },
    sourceFlags: input.sourceFlags ?? ["RESULTADOS"],
    metadata: input.metadata ?? null,
    sourceUrl: input.sourceUrl ?? null,
    matchKey: input.matchKey,
  };
}

test("deduplicacao cross-category preserva o jogo da categoria cujo pool combina com os atletas", () => {
  const service = new UpsertService() as unknown as {
    deduplicateCrossCategoryHashMatches(input: {
      matches: ParsedMatch[];
      categoriesByCbtmId: Map<string, { id: number; normalizedName: string; cbtmCategoryId: string | null }>;
      athleteIdsByCategoryCbtmId: Map<string, Set<number>>;
      aliasToAthleteIds: Map<string, Set<number>>;
      athletesById: Map<number, { nameDisplay: string }>;
    }): { matches: ParsedMatch[]; removed: number; droppedMatchKeys: string[]; warnings: string[] };
  };

  const expected = buildMatch({
    categoryId: "1050",
    categoryName: "RHM",
    categoryNormalizedName: "rhm",
    athleteAName: "ARNALDO SOUTO",
    athleteANormalizedName: "arnaldo souto",
    athleteBName: "BRUNO GARCIA",
    athleteBNormalizedName: "bruno garcia",
    matchKey: "cat:id:1050|dup-hash",
  });

  const wrongCategory = buildMatch({
    categoryId: "260",
    categoryName: "MASTER 50MAS",
    categoryNormalizedName: "master 50mas",
    athleteAName: "ARNALDO SOUTO",
    athleteANormalizedName: "arnaldo souto",
    athleteBName: "BRUNO GARCIA",
    athleteBNormalizedName: "bruno garcia",
    matchKey: "cat:id:260|dup-hash",
    tableNumber: null,
    matchDatetime: null,
  });

  const result = service.deduplicateCrossCategoryHashMatches({
    matches: [wrongCategory, expected],
    categoriesByCbtmId: new Map([
      ["1050", { id: 1, normalizedName: "rhm", cbtmCategoryId: "1050" }],
      ["260", { id: 2, normalizedName: "master 50mas", cbtmCategoryId: "260" }],
    ]),
    athleteIdsByCategoryCbtmId: new Map([
      ["1050", new Set([1, 2])],
      ["260", new Set([3, 4])],
    ]),
    aliasToAthleteIds: new Map([
      ["arnaldo souto", new Set([1])],
      ["bruno garcia", new Set([2])],
    ]),
    athletesById: new Map([
      [1, { nameDisplay: "ARNALDO SOUTO" }],
      [2, { nameDisplay: "BRUNO GARCIA" }],
      [3, { nameDisplay: "AFONSO FURTADO" }],
      [4, { nameDisplay: "JACOB FILHO" }],
    ]),
  });

  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0]?.categoryId, "1050");
  assert.equal(result.removed, 1);
  assert.deepEqual(result.droppedMatchKeys, ["cat:id:260|dup-hash"]);
});

test("cleanupStaleMatchConflicts remove conflitos fora dos contextos ativos e atualiza mapa", async () => {
  const service = new UpsertService() as unknown as {
    cleanupStaleMatchConflicts(input: {
      eventId: number;
      activeContexts: Set<string>;
      conflictsByKey: Map<string, unknown>;
      updated: Record<string, number>;
      warnings: string[];
    }): Promise<void>;
  };

  const originalFindMany = prisma.athleteMatchConflict.findMany;
  const originalDeleteMany = prisma.athleteMatchConflict.deleteMany;

  const deletedIds: number[] = [];
  prisma.athleteMatchConflict.findMany = (async () => [
    { id: 11, context: "ctx:old", shortNameNormalized: "atleta a" },
    { id: 12, context: "ctx:old2", shortNameNormalized: "atleta b" },
  ]) as typeof prisma.athleteMatchConflict.findMany;
  prisma.athleteMatchConflict.deleteMany = (async (args: { where: { id: { in: number[] } } }) => {
    deletedIds.push(...args.where.id.in);
    return { count: args.where.id.in.length };
  }) as typeof prisma.athleteMatchConflict.deleteMany;

  try {
    const conflictsByKey = new Map<string, unknown>([
      ["ctx:active|atleta c", { id: 10 }],
      ["ctx:old|atleta a", { id: 11 }],
      ["ctx:old2|atleta b", { id: 12 }],
    ]);
    const updated: Record<string, number> = {};
    const warnings: string[] = [];

    await service.cleanupStaleMatchConflicts({
      eventId: 43,
      activeContexts: new Set(["ctx:active"]),
      conflictsByKey,
      updated,
      warnings,
    });

    assert.deepEqual(deletedIds, [11, 12]);
    assert.deepEqual([...conflictsByKey.keys()], ["ctx:active|atleta c"]);
    assert.equal(updated.athlete_conflicts_removed_stale, 2);
    assert.match(warnings[0] ?? "", /2 conflito\(s\) obsoleto\(s\)/i);
  } finally {
    prisma.athleteMatchConflict.findMany = originalFindMany;
    prisma.athleteMatchConflict.deleteMany = originalDeleteMany;
  }
});

test("sanitizeRegistrationOrphanAthletes remove apenas atletas sem categorias e sem partidas", async () => {
  const service = new UpsertService() as unknown as {
    sanitizeRegistrationOrphanAthletes(input: {
      eventId: number;
      updated: Record<string, number>;
      warnings: string[];
    }): Promise<void>;
  };

  const originalFindManyAthlete = prisma.athlete.findMany;
  const originalFindManyMatchParticipant = prisma.matchParticipant.findMany;
  const originalTransaction = prisma.$transaction;

  const deleted: Record<string, number[]> = {
    aliases: [],
    categories: [],
    athletes: [],
  };

  prisma.athlete.findMany = (async () => [
    { id: 101, nameDisplay: "ATLETA ORFAO" },
    { id: 102, nameDisplay: "ATLETA COM JOGO" },
  ]) as typeof prisma.athlete.findMany;
  prisma.matchParticipant.findMany = (async () => [{ athleteId: 102 }]) as typeof prisma.matchParticipant.findMany;
  prisma.$transaction = (async (
    callback: (tx: {
      athleteAlias: { deleteMany(args: { where: { athleteId: { in: number[] } } }): Promise<unknown> };
      athleteCategory: { deleteMany(args: { where: { athleteId: { in: number[] } } }): Promise<unknown> };
      athlete: { deleteMany(args: { where: { id: { in: number[] } } }): Promise<unknown> };
    }) => Promise<void>,
  ) => {
    await callback({
      athleteAlias: {
        deleteMany: async (args) => {
          deleted.aliases.push(...args.where.athleteId.in);
          return { count: args.where.athleteId.in.length };
        },
      },
      athleteCategory: {
        deleteMany: async (args) => {
          deleted.categories.push(...args.where.athleteId.in);
          return { count: args.where.athleteId.in.length };
        },
      },
      athlete: {
        deleteMany: async (args) => {
          deleted.athletes.push(...args.where.id.in);
          return { count: args.where.id.in.length };
        },
      },
    });
  }) as typeof prisma.$transaction;

  try {
    const updated: Record<string, number> = {};
    const warnings: string[] = [];

    await service.sanitizeRegistrationOrphanAthletes({
      eventId: 43,
      updated,
      warnings,
    });

    assert.deepEqual(deleted.aliases, [101]);
    assert.deepEqual(deleted.categories, [101]);
    assert.deepEqual(deleted.athletes, [101]);
    assert.equal(updated.athletes_removed_without_category_link, 1);
    assert.match(warnings[0] ?? "", /preservou 1 atleta\(s\)/i);
    assert.match(warnings[1] ?? "", /removeu 1 atleta\(s\) sem vinculo atleta-categoria/i);
  } finally {
    prisma.athlete.findMany = originalFindManyAthlete;
    prisma.matchParticipant.findMany = originalFindManyMatchParticipant;
    prisma.$transaction = originalTransaction;
  }
});

test("sanitizeRegistrationOrphanCategories remove categorias ausentes sem vinculos e sem partidas", async () => {
  const service = new UpsertService() as unknown as {
    sanitizeRegistrationOrphanCategories(input: {
      eventId: number;
      observedCategoryIds: Set<number>;
      updated: Record<string, number>;
      warnings: string[];
    }): Promise<void>;
  };

  const originalCategoryFindMany = prisma.category.findMany;
  const originalMatchFindMany = prisma.match.findMany;
  const originalCategoryDeleteMany = prisma.category.deleteMany;

  const deletedCategoryIds: number[] = [];

  prisma.category.findMany = (async () => [
    { id: 501, name: "ABSOLUTO C (FEM)" },
    { id: 502, name: "ABSOLUTO E (FEM)" },
  ]) as typeof prisma.category.findMany;
  prisma.match.findMany = (async () => [{ categoryId: 502 }]) as typeof prisma.match.findMany;
  prisma.category.deleteMany = (async (args) => {
    deletedCategoryIds.push(...args.where.id.in);
    return { count: args.where.id.in.length };
  }) as typeof prisma.category.deleteMany;

  try {
    const updated: Record<string, number> = {};
    const warnings: string[] = [];

    await service.sanitizeRegistrationOrphanCategories({
      eventId: 49,
      observedCategoryIds: new Set([310, 66]),
      updated,
      warnings,
    });

    assert.deepEqual(deletedCategoryIds, [501]);
    assert.equal(updated.categories_removed_without_links, 1);
    assert.match(warnings[0] ?? "", /preservou 1 categoria\(s\) orfa\(s\)/i);
    assert.match(warnings[1] ?? "", /removeu 1 categoria\(s\) sem vinculos e sem partidas/i);
  } finally {
    prisma.category.findMany = originalCategoryFindMany;
    prisma.match.findMany = originalMatchFindMany;
    prisma.category.deleteMany = originalCategoryDeleteMany;
  }
});

test("syncMutableRegistrationCategories bloqueia remocoes ate confirmar 2 runs consecutivos", async () => {
  const service = new UpsertService() as unknown as {
    syncMutableRegistrationCategories(input: {
      eventId: number;
      observedRegistrationPairs: Map<
        string,
        {
          athleteId: number;
          categoryId: number;
          categoryName: string;
          registrationStatus: "INSCRITO" | "PRE_INSCRITO" | "OUTRO" | null;
        }
      >;
      updated: Record<string, number>;
      warnings: string[];
    }): Promise<{
      categoryHashes: Record<string, string>;
      categoryCoverage: Record<string, number>;
      categoryGapTotals: Record<string, number>;
      categoriesConfirmedForRemoval: string[];
      categoriesBlockedByConfirmation: string[];
      categoriesBlockedByCoverage: string[];
    }>;
  };

  const originalAthleteCategoryFindMany = prisma.athleteCategory.findMany;
  const originalAthleteCategoryDeleteMany = prisma.athleteCategory.deleteMany;
  const originalScrapeRunFindMany = prisma.scrapeRun.findMany;

  let deleteManyCalls = 0;
  prisma.athleteCategory.findMany = (async () => [
    {
      athleteId: 10,
      categoryId: 501,
      registrationStatus: "INSCRITO",
      athlete: { id: 10, nameDisplay: "ATLETA A" },
      category: { id: 501, name: "ABSOLUTO A", cbtmCategoryId: null },
    },
    {
      athleteId: 11,
      categoryId: 501,
      registrationStatus: "INSCRITO",
      athlete: { id: 11, nameDisplay: "ATLETA B" },
      category: { id: 501, name: "ABSOLUTO A", cbtmCategoryId: null },
    },
    {
      athleteId: 12,
      categoryId: 501,
      registrationStatus: "INSCRITO",
      athlete: { id: 12, nameDisplay: "ATLETA C" },
      category: { id: 501, name: "ABSOLUTO A", cbtmCategoryId: null },
    },
    {
      athleteId: 13,
      categoryId: 501,
      registrationStatus: "INSCRITO",
      athlete: { id: 13, nameDisplay: "ATLETA D" },
      category: { id: 501, name: "ABSOLUTO A", cbtmCategoryId: null },
    },
    {
      athleteId: 14,
      categoryId: 501,
      registrationStatus: "INSCRITO",
      athlete: { id: 14, nameDisplay: "ATLETA E" },
      category: { id: 501, name: "ABSOLUTO A", cbtmCategoryId: null },
    },
    {
      athleteId: 15,
      categoryId: 501,
      registrationStatus: "INSCRITO",
      athlete: { id: 15, nameDisplay: "ATLETA F" },
      category: { id: 501, name: "ABSOLUTO A", cbtmCategoryId: null },
    },
    {
      athleteId: 16,
      categoryId: 501,
      registrationStatus: "INSCRITO",
      athlete: { id: 16, nameDisplay: "ATLETA G" },
      category: { id: 501, name: "ABSOLUTO A", cbtmCategoryId: null },
    },
  ]) as typeof prisma.athleteCategory.findMany;
  prisma.athleteCategory.deleteMany = (async () => {
    deleteManyCalls += 1;
    return { count: 0 };
  }) as typeof prisma.athleteCategory.deleteMany;
  prisma.scrapeRun.findMany = (async () => []) as typeof prisma.scrapeRun.findMany;

  try {
    const updated: Record<string, number> = {};
    const warnings: string[] = [];
    const observedRegistrationPairs = new Map([
      [
        "10|501",
        {
          athleteId: 10,
          categoryId: 501,
          categoryName: "ABSOLUTO A",
          registrationStatus: "INSCRITO" as const,
        },
      ],
      [
        "12|501",
        {
          athleteId: 12,
          categoryId: 501,
          categoryName: "ABSOLUTO A",
          registrationStatus: "INSCRITO" as const,
        },
      ],
      [
        "13|501",
        {
          athleteId: 13,
          categoryId: 501,
          categoryName: "ABSOLUTO A",
          registrationStatus: "INSCRITO" as const,
        },
      ],
      [
        "14|501",
        {
          athleteId: 14,
          categoryId: 501,
          categoryName: "ABSOLUTO A",
          registrationStatus: "INSCRITO" as const,
        },
      ],
      [
        "15|501",
        {
          athleteId: 15,
          categoryId: 501,
          categoryName: "ABSOLUTO A",
          registrationStatus: "INSCRITO" as const,
        },
      ],
      [
        "16|501",
        {
          athleteId: 16,
          categoryId: 501,
          categoryName: "ABSOLUTO A",
          registrationStatus: "INSCRITO" as const,
        },
      ],
    ]);

    const stats = await service.syncMutableRegistrationCategories({
      eventId: 43,
      observedRegistrationPairs,
      updated,
      warnings,
    });

    assert.equal(deleteManyCalls, 0);
    assert.equal(updated.registration_sync_skipped_confirmation, 1);
    assert.deepEqual(stats.categoriesBlockedByConfirmation, ["ABSOLUTO A#501"]);
    assert.deepEqual(stats.categoriesConfirmedForRemoval, []);
    assert.match(warnings[0] ?? "", /aguardando 2 runs consecutivos/i);
  } finally {
    prisma.athleteCategory.findMany = originalAthleteCategoryFindMany;
    prisma.athleteCategory.deleteMany = originalAthleteCategoryDeleteMany;
    prisma.scrapeRun.findMany = originalScrapeRunFindMany;
  }
});

test("syncMutableRegistrationCategories remove vinculos obsoletos apos confirmacao por hash e cobertura", async () => {
  const service = new UpsertService() as unknown as {
    syncMutableRegistrationCategories(input: {
      eventId: number;
      observedRegistrationPairs: Map<
        string,
        {
          athleteId: number;
          categoryId: number;
          categoryName: string;
          registrationStatus: "INSCRITO" | "PRE_INSCRITO" | "OUTRO" | null;
        }
      >;
      updated: Record<string, number>;
      warnings: string[];
    }): Promise<{
      categoryHashes: Record<string, string>;
      categoryCoverage: Record<string, number>;
      categoryGapTotals: Record<string, number>;
      categoriesConfirmedForRemoval: string[];
      categoriesBlockedByConfirmation: string[];
      categoriesBlockedByCoverage: string[];
    }>;
  };

  const originalAthleteCategoryFindMany = prisma.athleteCategory.findMany;
  const originalAthleteCategoryDeleteMany = prisma.athleteCategory.deleteMany;
  const originalScrapeRunFindMany = prisma.scrapeRun.findMany;

  const deletedPairs: Array<{ athleteId: number; categoryIds: number[] }> = [];
  prisma.athleteCategory.findMany = (async () => [
    {
      athleteId: 10,
      categoryId: 501,
      registrationStatus: "INSCRITO",
      athlete: { id: 10, nameDisplay: "ATLETA A" },
      category: { id: 501, name: "ABSOLUTO A", cbtmCategoryId: null },
    },
    {
      athleteId: 11,
      categoryId: 501,
      registrationStatus: "INSCRITO",
      athlete: { id: 11, nameDisplay: "ATLETA B" },
      category: { id: 501, name: "ABSOLUTO A", cbtmCategoryId: null },
    },
    {
      athleteId: 12,
      categoryId: 501,
      registrationStatus: "INSCRITO",
      athlete: { id: 12, nameDisplay: "ATLETA C" },
      category: { id: 501, name: "ABSOLUTO A", cbtmCategoryId: null },
    },
    {
      athleteId: 13,
      categoryId: 501,
      registrationStatus: "INSCRITO",
      athlete: { id: 13, nameDisplay: "ATLETA D" },
      category: { id: 501, name: "ABSOLUTO A", cbtmCategoryId: null },
    },
    {
      athleteId: 14,
      categoryId: 501,
      registrationStatus: "INSCRITO",
      athlete: { id: 14, nameDisplay: "ATLETA E" },
      category: { id: 501, name: "ABSOLUTO A", cbtmCategoryId: null },
    },
    {
      athleteId: 15,
      categoryId: 501,
      registrationStatus: "INSCRITO",
      athlete: { id: 15, nameDisplay: "ATLETA F" },
      category: { id: 501, name: "ABSOLUTO A", cbtmCategoryId: null },
    },
    {
      athleteId: 16,
      categoryId: 501,
      registrationStatus: "INSCRITO",
      athlete: { id: 16, nameDisplay: "ATLETA G" },
      category: { id: 501, name: "ABSOLUTO A", cbtmCategoryId: null },
    },
  ]) as typeof prisma.athleteCategory.findMany;
  prisma.athleteCategory.deleteMany = (async (args: { where: { athleteId: number; categoryId: { in: number[] } } }) => {
    deletedPairs.push({ athleteId: args.where.athleteId, categoryIds: args.where.categoryId.in });
    return { count: args.where.categoryId.in.length };
  }) as typeof prisma.athleteCategory.deleteMany;

  const confirmedHash = createHash("sha1")
    .update(["10:INSCRITO", "12:INSCRITO", "13:INSCRITO", "14:INSCRITO", "15:INSCRITO", "16:INSCRITO"].join("|"))
    .digest("hex");
  prisma.scrapeRun.findMany = (async () => [
    {
      extractionStats: {
        registrationSync: {
          categoryHashes: { "501": confirmedHash },
          categoryCoverage: { "501": 1 },
        },
      },
    },
  ]) as typeof prisma.scrapeRun.findMany;

  try {
    const updated: Record<string, number> = {};
    const warnings: string[] = [];
    const observedRegistrationPairs = new Map([
      [
        "10|501",
        {
          athleteId: 10,
          categoryId: 501,
          categoryName: "ABSOLUTO A",
          registrationStatus: "INSCRITO" as const,
        },
      ],
      [
        "12|501",
        {
          athleteId: 12,
          categoryId: 501,
          categoryName: "ABSOLUTO A",
          registrationStatus: "INSCRITO" as const,
        },
      ],
      [
        "13|501",
        {
          athleteId: 13,
          categoryId: 501,
          categoryName: "ABSOLUTO A",
          registrationStatus: "INSCRITO" as const,
        },
      ],
      [
        "14|501",
        {
          athleteId: 14,
          categoryId: 501,
          categoryName: "ABSOLUTO A",
          registrationStatus: "INSCRITO" as const,
        },
      ],
      [
        "15|501",
        {
          athleteId: 15,
          categoryId: 501,
          categoryName: "ABSOLUTO A",
          registrationStatus: "INSCRITO" as const,
        },
      ],
      [
        "16|501",
        {
          athleteId: 16,
          categoryId: 501,
          categoryName: "ABSOLUTO A",
          registrationStatus: "INSCRITO" as const,
        },
      ],
    ]);

    const stats = await service.syncMutableRegistrationCategories({
      eventId: 43,
      observedRegistrationPairs,
      updated,
      warnings,
    });

    assert.deepEqual(deletedPairs, [{ athleteId: 11, categoryIds: [501] }]);
    assert.equal(updated.athlete_categories_removed_from_snapshot, 1);
    assert.deepEqual(stats.categoriesConfirmedForRemoval, ["ABSOLUTO A#501"]);
    assert.deepEqual(stats.categoriesBlockedByConfirmation, []);
    assert.match(warnings[0] ?? "", /removeu categorias antigas de 'ATLETA B'/i);
    assert.match(warnings[1] ?? "", /removeu 1 vinculo\(s\) obsoleto\(s\) de atleta-categoria/i);
  } finally {
    prisma.athleteCategory.findMany = originalAthleteCategoryFindMany;
    prisma.athleteCategory.deleteMany = originalAthleteCategoryDeleteMany;
    prisma.scrapeRun.findMany = originalScrapeRunFindMany;
  }
});

test("syncMutableRegistrationCategories remove categoria ausente apos 2 runs consecutivos", async () => {
  const service = new UpsertService() as unknown as {
    syncMutableRegistrationCategories(input: {
      eventId: number;
      observedRegistrationPairs: Map<
        string,
        {
          athleteId: number;
          categoryId: number;
          categoryName: string;
          registrationStatus: "INSCRITO" | "PRE_INSCRITO" | "OUTRO" | null;
        }
      >;
      updated: Record<string, number>;
      warnings: string[];
    }): Promise<{
      categoryHashes: Record<string, string>;
      categoryCoverage: Record<string, number>;
      categoryGapTotals: Record<string, number>;
      categoriesConfirmedForRemoval: string[];
      categoriesBlockedByConfirmation: string[];
      categoriesBlockedByCoverage: string[];
    }>;
  };

  const originalAthleteCategoryFindMany = prisma.athleteCategory.findMany;
  const originalAthleteCategoryDeleteMany = prisma.athleteCategory.deleteMany;
  const originalScrapeRunFindMany = prisma.scrapeRun.findMany;

  const deletedPairs: Array<{ athleteId: number; categoryIds: number[] }> = [];
  prisma.athleteCategory.findMany = (async () => [
    {
      athleteId: 21,
      categoryId: 701,
      registrationStatus: "INSCRITO",
      athlete: { id: 21, nameDisplay: "ATLETA X" },
      category: { id: 701, name: "ABSOLUTO C (FEM)", cbtmCategoryId: "72" },
    },
    {
      athleteId: 22,
      categoryId: 701,
      registrationStatus: "INSCRITO",
      athlete: { id: 22, nameDisplay: "ATLETA Y" },
      category: { id: 701, name: "ABSOLUTO C (FEM)", cbtmCategoryId: "72" },
    },
  ]) as typeof prisma.athleteCategory.findMany;
  prisma.athleteCategory.deleteMany = (async (args) => {
    deletedPairs.push({
      athleteId: args.where.athleteId,
      categoryIds: args.where.categoryId.in,
    });
    return { count: args.where.categoryId.in.length };
  }) as typeof prisma.athleteCategory.deleteMany;
  prisma.scrapeRun.findMany = (async () => [
    {
      extractionStats: {
        registrationSync: {
          categoryHashes: {
            "701": createHash("sha1").update("").digest("hex"),
          },
          categoryCoverage: {
            "701": 0,
          },
        },
      },
    },
  ]) as typeof prisma.scrapeRun.findMany;

  try {
    const updated: Record<string, number> = {};
    const warnings: string[] = [];

    const stats = await service.syncMutableRegistrationCategories({
      eventId: 49,
      observedRegistrationPairs: new Map(),
      updated,
      warnings,
    });

    assert.deepEqual(deletedPairs, [
      { athleteId: 21, categoryIds: [701] },
      { athleteId: 22, categoryIds: [701] },
    ]);
    assert.equal(updated.athlete_categories_removed_from_snapshot, 2);
    assert.deepEqual(stats.categoriesConfirmedForRemoval, ["ABSOLUTO C (FEM)#701"]);
    assert.match(warnings[0] ?? "", /removeu categorias antigas de 'ATLETA X'/i);
    assert.match(warnings[1] ?? "", /removeu categorias antigas de 'ATLETA Y'/i);
  } finally {
    prisma.athleteCategory.findMany = originalAthleteCategoryFindMany;
    prisma.athleteCategory.deleteMany = originalAthleteCategoryDeleteMany;
    prisma.scrapeRun.findMany = originalScrapeRunFindMany;
  }
});

test("reportRegistrationSnapshotStats registra mismatch por categoria quando snapshot e banco divergem", async () => {
  const service = new UpsertService() as unknown as {
    reportRegistrationSnapshotStats(input: {
      eventId: number;
      observedRegistrationStatsByCategory: Map<
        number,
        {
          categoryId: number;
          categoryName: string;
          total: number;
          inscrito: number;
          preInscrito: number;
          outro: number;
        }
      >;
      updated: Record<string, number>;
      warnings: string[];
    }): Promise<void>;
  };

  const originalAthleteCategoryFindMany = prisma.athleteCategory.findMany;
  prisma.athleteCategory.findMany = (async () => [
    { athleteId: 10, categoryId: 501, registrationStatus: "INSCRITO" },
    { athleteId: 11, categoryId: 501, registrationStatus: "PRE_INSCRITO" },
    { athleteId: 12, categoryId: 502, registrationStatus: "INSCRITO" },
  ]) as typeof prisma.athleteCategory.findMany;

  try {
    const updated: Record<string, number> = {};
    const warnings: string[] = [];
    const observedRegistrationStatsByCategory = new Map([
      [
        501,
        {
          categoryId: 501,
          categoryName: "ABSOLUTO A",
          total: 2,
          inscrito: 2,
          preInscrito: 0,
          outro: 0,
        },
      ],
      [
        502,
        {
          categoryId: 502,
          categoryName: "ABSOLUTO B",
          total: 1,
          inscrito: 1,
          preInscrito: 0,
          outro: 0,
        },
      ],
    ]);

    await service.reportRegistrationSnapshotStats({
      eventId: 43,
      observedRegistrationStatsByCategory,
      updated,
      warnings,
    });

    assert.equal(updated.registration_categories_snapshot_checked, 2);
    assert.equal(updated.registration_categories_snapshot_mismatch, 1);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? "", /\[registration_sync\]\[categoria=ABSOLUTO A#501\]/i);
    assert.match(warnings[0] ?? "", /fonte\(total=2, inscrito=2, pre=0, outro=0\)/i);
    assert.match(warnings[0] ?? "", /banco\(total=2, inscrito=1, pre=1, outro=0\)/i);
  } finally {
    prisma.athleteCategory.findMany = originalAthleteCategoryFindMany;
  }
});
