import assert from "node:assert/strict";
import test from "node:test";
import type { ParsedDataset, ParsedMatch } from "@cbtm/shared";
import { extractCbtmMatchId } from "../src/pipeline/match-merge";
import { UpsertService } from "../src/pipeline/upsert.service";
import { prisma } from "../src/prisma";

let eventSequence = 54000;

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
  const event = await prisma.event.create({
    data: {
      cbtmEventId: ++eventSequence,
      nome: `PP-054 TEST ${eventSequence}`,
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
        matchKey: "sem-id-mesa-17",
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
        matchKey: "sem-id-mesa-19",
        tableNumber: "19",
        matchDatetime: "2026-09-18T15:30:00.000Z",
      }),
    ),
    { processRegistrations: false },
  );

  assert.equal(await prisma.match.count({ where: { eventId } }), 2);
});
