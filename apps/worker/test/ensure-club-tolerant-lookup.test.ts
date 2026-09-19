import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import test, { after } from "node:test";
import type { ParsedDataset } from "@cbtm/shared";
import { UpsertService } from "../src/pipeline/upsert.service";
import { prisma } from "../src/prisma";

const testEventIds: number[] = [];
const testClubIds: number[] = [];

after(async () => {
  for (const eventId of testEventIds) {
    await prisma.eventAthleteLink.deleteMany({ where: { eventId } });
    await prisma.athleteCategory.deleteMany({ where: { athlete: { eventId } } });
    await prisma.athleteAlias.deleteMany({ where: { athlete: { eventId } } });
    await prisma.athlete.deleteMany({ where: { eventId } });
    await prisma.category.deleteMany({ where: { eventId } });
    await prisma.event.delete({ where: { id: eventId } });
  }
  for (const clubId of testClubIds) {
    await prisma.club.deleteMany({ where: { id: clubId } });
  }
  await prisma.$disconnect();
});

function buildDatasetWithRegistration(input: {
  athleteName: string;
  athleteNormalized: string;
  clubName: string;
  clubNormalized: string;
  categoryId: string;
  categoryName: string;
}): ParsedDataset {
  return {
    categories: [
      {
        categoryId: input.categoryId,
        categoryName: input.categoryName,
        categoryNormalizedName: input.categoryName.toLowerCase(),
        valid: true,
        source: "INSCRICOES",
      },
    ],
    registrations: [
      {
        categoryId: input.categoryId,
        athleteName: input.athleteName,
        athleteNormalizedName: input.athleteNormalized,
        clubName: input.clubName,
        clubNormalizedName: input.clubNormalized,
        categoryName: input.categoryName,
        categoryNormalizedName: input.categoryName.toLowerCase(),
        status: "INSCRITO",
        rankingPoints: null,
        ratingPoints: null,
      },
    ],
    matches: [],
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
      nome: `PP-062 TEST ${cbtmEventId}`,
      concluido: false,
    },
    select: { id: true },
  });
  testEventIds.push(event.id);
  return event.id;
}

async function createLegacyClub(name: string, legacyNormalizedName: string) {
  const club = await prisma.club.create({
    data: { name, normalizedName: legacyNormalizedName },
  });
  testClubIds.push(club.id);
  return club;
}

test("T-U-01 busca tolerante reusa clube legado com sufixo divergente", async () => {
  const eventId = await createTestEvent();
  const suffix = randomInt(100_000, 999_999);
  const clubDisplayName = `CABANA CLUBE PP062 ${suffix} - PA`;
  const legacyClub = await createLegacyClub(
    clubDisplayName,
    `cabana clube pp062 ${suffix} - pa`,
  );
  const service = new UpsertService();

  const dataset = buildDatasetWithRegistration({
    athleteName: "ATLETA TOLERANTE UM",
    athleteNormalized: `atleta tolerante um ${suffix}`,
    clubName: clubDisplayName,
    clubNormalized: clubDisplayName,
    categoryId: `cat-tolerante-1-${suffix}`,
    categoryName: "ABSOLUTO",
  });

  await service.upsert(eventId, dataset, { processRegistrations: true });

  const clubsWithThisName = await prisma.club.findMany({
    where: { name: clubDisplayName },
  });
  assert.equal(clubsWithThisName.length, 1, "não deve criar um segundo clube para o mesmo nome legado");
  assert.equal(clubsWithThisName[0]!.id, legacyClub.id);
  assert.equal(clubsWithThisName[0]!.normalizedName, `cabana clube pp062 ${suffix}`);

  const athlete = await prisma.athlete.findFirstOrThrow({
    where: { eventId, nameNormalized: `atleta tolerante um ${suffix}` },
  });
  assert.equal(athlete.clubId, legacyClub.id);
});

test("T-U-02 busca tolerante não altera caminho já correto", async () => {
  const eventId = await createTestEvent();
  const suffix = randomInt(100_000, 999_999);
  const clubDisplayName = `PARA CLUBE MODERNO PP062 ${suffix}`;
  const modernClub = await createLegacyClub(
    clubDisplayName,
    `para clube moderno pp062 ${suffix}`,
  );
  const service = new UpsertService();

  const dataset = buildDatasetWithRegistration({
    athleteName: "ATLETA TOLERANTE DOIS",
    athleteNormalized: `atleta tolerante dois ${suffix}`,
    clubName: clubDisplayName,
    clubNormalized: clubDisplayName,
    categoryId: `cat-tolerante-2-${suffix}`,
    categoryName: "ABSOLUTO",
  });

  await service.upsert(eventId, dataset, { processRegistrations: true });

  const clubsWithThisName = await prisma.club.findMany({
    where: { name: clubDisplayName },
  });
  assert.equal(clubsWithThisName.length, 1);
  assert.equal(clubsWithThisName[0]!.id, modernClub.id);
  assert.equal(clubsWithThisName[0]!.normalizedName, `para clube moderno pp062 ${suffix}`);
});
