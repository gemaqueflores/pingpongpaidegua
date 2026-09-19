import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import test, { after } from "node:test";
import type { ParsedDataset } from "@cbtm/shared";
import { normalizeClubName } from "@cbtm/shared";
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
    await prisma.event.delete({ where: { id: eventId } });
  }
  for (const clubId of testClubIds) {
    await prisma.club.deleteMany({ where: { id: clubId } });
  }
  await prisma.$disconnect();
});

function buildEmptyDataset(): ParsedDataset {
  return {
    categories: [],
    registrations: [],
    matches: [],
    warnings: [],
    extractionStats: {
      totalCategoriesFound: 0,
      totalCategoriesValid: 0,
      categoriesScanned: 0,
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
      nome: `PP-056 TEST ${cbtmEventId}`,
      concluido: false,
    },
    select: { id: true },
  });
  testEventIds.push(event.id);
  return event.id;
}

async function createTestClub(normalizedName: string, name?: string) {
  const club = await prisma.club.create({
    data: {
      name: name ?? normalizedName,
      normalizedName,
    },
  });
  testClubIds.push(club.id);
  return club;
}

async function createTestAthlete(input: {
  eventId: number;
  clubId: number;
  nameDisplay: string;
  nameNormalized: string;
}) {
  return prisma.athlete.create({
    data: {
      eventId: input.eventId,
      clubId: input.clubId,
      nameDisplay: input.nameDisplay,
      nameNormalized: input.nameNormalized,
    },
  });
}

test("T-I-01 mudanca de clube normalizado migra a linha existente sem lancar excecao", async () => {
  const eventId = await createTestEvent();
  const club = await createTestClub("clube antigo");
  const athlete = await createTestAthlete({
    eventId,
    clubId: club.id,
    nameDisplay: "ATLETA UM",
    nameNormalized: "atleta um",
  });
  const service = new UpsertService();

  await service.upsert(eventId, buildEmptyDataset(), { processRegistrations: false });

  const linkBefore = await prisma.eventAthleteLink.findFirstOrThrow({
    where: { eventId, athleteId: athlete.id },
  });
  assert.equal(linkBefore.athleteKey, "atleta um|clube antigo");

  await prisma.club.update({
    where: { id: club.id },
    data: { normalizedName: "clube novo" },
  });

  await assert.doesNotReject(() =>
    service.upsert(eventId, buildEmptyDataset(), { processRegistrations: false }),
  );

  const count = await prisma.eventAthleteLink.count({
    where: { eventId, athleteId: athlete.id },
  });
  assert.equal(count, 1);

  const linkAfter = await prisma.eventAthleteLink.findFirstOrThrow({
    where: { eventId, athleteId: athlete.id },
  });
  assert.equal(linkAfter.athleteKey, "atleta um|clube novo");
});

test("T-I-02 atleta inedito continua criando linha normalmente", async () => {
  const eventId = await createTestEvent();
  const club = await createTestClub("clube regressao");
  const athlete = await createTestAthlete({
    eventId,
    clubId: club.id,
    nameDisplay: "ATLETA DOIS",
    nameNormalized: "atleta dois",
  });
  const service = new UpsertService();

  await service.upsert(eventId, buildEmptyDataset(), { processRegistrations: false });

  const link = await prisma.eventAthleteLink.findFirstOrThrow({
    where: { eventId, athleteId: athlete.id },
  });
  assert.equal(link.athleteId, athlete.id);
  assert.equal(link.athleteKey, "atleta dois|clube regressao");
  assert.equal(link.athleteName, "ATLETA DOIS");
});

test("T-I-03 dois atletas com mesma chave continuam gerando warning", async () => {
  const eventId = await createTestEvent();
  // Dois clubes com nomes normalizados distintos no banco (diferem por acentuacao) que colapsam
  // para a mesma chave apos normalizeText() dentro de buildEventAthleteLinkKey — reproduz colisao
  // de athleteKey sem violar a unicidade de (event_id, name_normalized, club_id).
  const clubX = await createTestClub("clube warning");
  const clubY = await createTestClub("clube wárning");
  await createTestAthlete({
    eventId,
    clubId: clubX.id,
    nameDisplay: "ATLETA TRES",
    nameNormalized: "atleta tres",
  });
  await createTestAthlete({
    eventId,
    clubId: clubY.id,
    nameDisplay: "ATLETA TRES",
    nameNormalized: "atleta tres",
  });
  const service = new UpsertService();

  const result = await service.upsert(eventId, buildEmptyDataset(), {
    processRegistrations: false,
  });

  assert.ok(
    result.warnings.some((warning) => warning.includes("Link estavel duplicado detectado")),
  );
});

test("T-I-04 reproducao do cenario real do evento 59 com multiplos atletas e clubes renomeados", async () => {
  const eventId = await createTestEvent();
  const clubA = await createTestClub("yoshida tt pa");
  const clubB = await createTestClub("tenis de mesa salinas tdms");
  const athletes = await Promise.all([
    createTestAthlete({
      eventId,
      clubId: clubA.id,
      nameDisplay: "ATLETA QUATRO",
      nameNormalized: "atleta quatro",
    }),
    createTestAthlete({
      eventId,
      clubId: clubA.id,
      nameDisplay: "ATLETA CINCO",
      nameNormalized: "atleta cinco",
    }),
    createTestAthlete({
      eventId,
      clubId: clubB.id,
      nameDisplay: "ATLETA SEIS",
      nameNormalized: "atleta seis",
    }),
  ]);
  const service = new UpsertService();

  await service.upsert(eventId, buildEmptyDataset(), { processRegistrations: false });

  const initialCount = await prisma.eventAthleteLink.count({ where: { eventId } });
  assert.equal(initialCount, athletes.length);

  await prisma.club.update({
    where: { id: clubA.id },
    data: { normalizedName: "pa yoshida" },
  });
  await prisma.club.update({
    where: { id: clubB.id },
    data: { normalizedName: "pa salinas" },
  });

  await assert.doesNotReject(() =>
    service.upsert(eventId, buildEmptyDataset(), { processRegistrations: false }),
  );

  const finalCount = await prisma.eventAthleteLink.count({ where: { eventId } });
  assert.equal(finalCount, initialCount);

  for (const athlete of athletes) {
    const link = await prisma.eventAthleteLink.findFirstOrThrow({
      where: { eventId, athleteId: athlete.id },
    });
    assert.ok(link.athleteKey.startsWith("atleta") && link.athleteKey.includes("|pa "));
  }
});

test("T-U-01 matching de clube via partida ignora variacao de sufixo UF", () => {
  // Exercita a mesma funcao real (normalizeClubName, de @cbtm/shared) que
  // upsert.service.ts usa nas linhas 1557/1583 para calcular clubNormalizedName
  // a partir de parsedMatch.athleteA/BClubNormalizedName. Duas variacoes de sufixo
  // de UF para o mesmo clube fisico nao devem produzir valores normalizados
  // divergentes — caso contrario resolveMatchAthlete trataria como clubes distintos.
  const withDash = normalizeClubName("Clube X - PA");
  const withParens = normalizeClubName("Clube X (PA)");

  assert.equal(withDash, withParens);
  assert.equal(withDash, "clube x");
});
