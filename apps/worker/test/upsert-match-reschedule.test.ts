import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import test from "node:test";
import type { ParsedDataset, ParsedMatch } from "@cbtm/shared";
import { extractCbtmMatchId } from "../src/pipeline/match-merge";
import { UpsertService } from "../src/pipeline/upsert.service";
import { prisma } from "../src/prisma";

function buildMatch(
  metadata: ParsedMatch["metadata"],
  overrides: Partial<ParsedMatch> = {},
): ParsedMatch {
  return {
    categoryId: "67",
    categoryName: "SUB-21 FEM",
    categoryNormalizedName: "sub-21 fem",
    phase: "RESULTADOS",
    round: "Final",
    tableNumber: "17",
    matchDatetime: "2026-09-18T14:30:00.000Z",
    athleteAName: "ATLETA A",
    athleteANormalizedName: "atleta a",
    athleteBName: "ATLETA B",
    athleteBNormalizedName: "atleta b",
    scoreRaw: "3-1",
    sets: [],
    setsResult: { p1Sets: 3, p2Sets: 1 },
    winnerIndex: 0,
    matchKey: "match-key",
    metadata,
    ...overrides,
  };
}

function buildDataset(match: ParsedMatch): ParsedDataset {
  return {
    categories: [],
    registrations: [],
    matches: [match],
    warnings: [],
    extractionStats: {
      totalCategoriesFound: 1,
      totalCategoriesValid: 1,
      categoriesScanned: 1,
      tabPayloadCounts: {},
      tabItemCounts: {},
      categoryTabPayloadCounts: {},
      registrationsByCategory: {},
      matchesByCategoryPhase: {},
      uniqueAthletesConsolidated: 0,
    },
  };
}

async function createTestEvent(): Promise<number> {
  const cbtmEventId = randomInt(1_000_000_000, 2_000_000_000);
  const event = await prisma.event.create({
    data: {
      cbtmEventId,
      nome: `PP-054 TEST ${cbtmEventId}`,
      concluido: false,
    },
    select: { id: true },
  });
  return event.id;
}

test("T-U-01 normaliza cbtmMatchId numerico com zeros a esquerda", () => {
  assert.equal(extractCbtmMatchId(buildMatch({ jogo: "2" })), "2");
  assert.equal(extractCbtmMatchId(buildMatch({ jogo: "002" })), "2");
});

test("T-I-02 preserva criacao de nova linha sem cbtmMatchId", async () => {
  const eventId = await createTestEvent();
  const service = new UpsertService();

  await service.upsert(
    eventId,
    buildDataset(
      buildMatch(null, {
        matchKey: `evento-${eventId}-sem-id-mesa-17`,
        round: "Grupo A",
        tableNumber: "17",
        matchDatetime: "2026-09-18T14:30:00.000Z",
      }),
    ),
    { processRegistrations: false },
  );
  await service.upsert(
    eventId,
    buildDataset(
      buildMatch(null, {
        matchKey: `evento-${eventId}-sem-id-mesa-19`,
        round: "Grupo A",
        tableNumber: "19",
        matchDatetime: "2026-09-18T15:30:00.000Z",
      }),
    ),
    { processRegistrations: false },
  );

  assert.equal(await prisma.match.count({ where: { eventId } }), 2);
});

test("T-I-01 reagendamento atualiza a linha preservando id e matchKey", async () => {
  const eventId = await createTestEvent();
  const service = new UpsertService();
  const originalDatetime = "2026-09-16T21:30:00.000Z";
  const rescheduledDatetime = "2026-09-18T14:30:00.000Z";

  await service.upsert(
    eventId,
    buildDataset(
      buildMatch({ jogo: "2" }, {
        matchKey: `evento-${eventId}-jogo-2-original`,
        tableNumber: "17",
        matchDatetime: originalDatetime,
      }),
    ),
    { processRegistrations: false },
  );

  const original = await prisma.match.findFirstOrThrow({
    where: { eventId, cbtmMatchId: "2" },
    select: { id: true, matchKey: true },
  });

  await service.upsert(
    eventId,
    buildDataset(
      buildMatch({ jogo: "2" }, {
        matchKey: `evento-${eventId}-jogo-2-reagendado`,
        tableNumber: "17",
        matchDatetime: rescheduledDatetime,
      }),
    ),
    { processRegistrations: false },
  );

  const matches = await prisma.match.findMany({
    where: { eventId, cbtmMatchId: "2" },
    select: { id: true, matchKey: true, matchDatetime: true },
  });
  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.id, original.id);
  assert.equal(matches[0]?.matchKey, original.matchKey);
  assert.equal(matches[0]?.matchDatetime?.toISOString(), rescheduledDatetime);
});

test("T-I-04 mantem o mesmo cbtmMatchId independente entre categorias", async () => {
  const eventId = await createTestEvent();
  const service = new UpsertService();
  const [categoryA, categoryB] = await Promise.all([
    prisma.category.create({
      data: {
        eventId,
        name: "SUB-21 FEM",
        normalizedName: "sub-21 fem",
        cbtmCategoryId: "67",
      },
    }),
    prisma.category.create({
      data: {
        eventId,
        name: "SUB-19 FEM",
        normalizedName: "sub-19 fem",
        cbtmCategoryId: "68",
      },
    }),
  ]);
  const [originalA, originalB] = await Promise.all([
    prisma.match.create({
      data: {
        eventId,
        categoryId: categoryA.id,
        cbtmMatchId: "2",
        phase: "RESULTADOS",
        round: "Final",
        tableNumber: "17",
        matchDatetime: new Date("2026-09-16T21:30:00.000Z"),
        scoreRaw: "3-1",
        matchKey: `evento-${eventId}-categoria-a-jogo-2`,
      },
    }),
    prisma.match.create({
      data: {
        eventId,
        categoryId: categoryB.id,
        cbtmMatchId: "2",
        phase: "RESULTADOS",
        round: "Final",
        tableNumber: "8",
        matchDatetime: new Date("2026-09-17T18:00:00.000Z"),
        scoreRaw: "3-2",
        matchKey: `evento-${eventId}-categoria-b-jogo-2`,
      },
    }),
  ]);

  await service.upsert(
    eventId,
    buildDataset(
      buildMatch({ jogo: "2" }, {
        categoryId: "67",
        categoryName: "SUB-21 FEM",
        categoryNormalizedName: "sub-21 fem",
        matchKey: `evento-${eventId}-categoria-a-jogo-2-reagendado`,
        tableNumber: "19",
        matchDatetime: "2026-09-18T16:30:00.000Z",
      }),
    ),
    { processRegistrations: false },
  );

  const [matches, persistedA, persistedB] = await Promise.all([
    prisma.match.count({ where: { eventId } }),
    prisma.match.findUniqueOrThrow({ where: { id: originalA.id } }),
    prisma.match.findUniqueOrThrow({ where: { id: originalB.id } }),
  ]);
  assert.equal(matches, 2);
  assert.equal(persistedA.matchKey, originalA.matchKey);
  assert.equal(persistedA.tableNumber, "19");
  assert.equal(persistedA.matchDatetime?.toISOString(), "2026-09-18T16:30:00.000Z");
  assert.equal(persistedB.tableNumber, originalB.tableNumber);
  assert.equal(persistedB.matchDatetime?.toISOString(), originalB.matchDatetime?.toISOString());
  assert.equal(persistedB.updatedAt.toISOString(), originalB.updatedAt.toISOString());
});

test("T-I-03 ambiguidade gera warning e nao escolhe linha arbitrariamente", async () => {
  const eventId = await createTestEvent();
  const service = new UpsertService();
  const category = await prisma.category.create({
    data: {
      eventId,
      name: "SUB-21 FEM",
      normalizedName: "sub-21 fem",
      cbtmCategoryId: "67",
    },
  });
  await Promise.all([
    prisma.match.create({
      data: {
        eventId,
        categoryId: category.id,
        cbtmMatchId: "2",
        phase: "RESULTADOS",
        round: "Final",
        tableNumber: "17",
        matchDatetime: new Date("2026-09-16T21:30:00.000Z"),
        scoreRaw: "3-1",
        matchKey: `evento-${eventId}-ambiguo-jogo-2-a`,
      },
    }),
    prisma.match.create({
      data: {
        eventId,
        categoryId: category.id,
        cbtmMatchId: "2",
        phase: "RESULTADOS",
        round: "Final",
        tableNumber: "18",
        matchDatetime: new Date("2026-09-17T21:30:00.000Z"),
        scoreRaw: "3-2",
        matchKey: `evento-${eventId}-ambiguo-jogo-2-b`,
      },
    }),
  ]);

  const result = await service.upsert(
    eventId,
    buildDataset(
      buildMatch({ jogo: "2" }, {
        matchKey: `evento-${eventId}-ambiguo-jogo-2-novo`,
        tableNumber: "19",
        matchDatetime: "2026-09-18T16:30:00.000Z",
      }),
    ),
    { processRegistrations: false },
  );

  assert.ok(
    result.warnings.some(
      (warning) => warning.includes("Ambiguidade") && warning.includes("cbtmMatchId=2"),
    ),
  );
  assert.equal(
    await prisma.match.count({ where: { eventId, categoryId: category.id, cbtmMatchId: "2" } }),
    3,
  );
});
