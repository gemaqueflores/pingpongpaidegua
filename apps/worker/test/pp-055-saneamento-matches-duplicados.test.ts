import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import test, { after } from "node:test";
import { runDuplicateMatchCleanup } from "../../../scripts/pp-055-saneamento-matches-duplicados";
import { prisma } from "../src/prisma";

const testEventIds: number[] = [];

after(async () => {
  for (const eventId of testEventIds) {
    await prisma.readModelCache.deleteMany({ where: { eventId } });
    await prisma.matchParticipant.deleteMany({ where: { match: { eventId } } });
    await prisma.athleteAlias.deleteMany({ where: { athlete: { eventId } } });
    await prisma.athleteCategory.deleteMany({ where: { athlete: { eventId } } });
    await prisma.athleteMatchConflict.deleteMany({ where: { eventId } });
    await prisma.match.deleteMany({ where: { eventId } });
    await prisma.athlete.deleteMany({ where: { eventId } });
    await prisma.category.deleteMany({ where: { eventId } });
    await prisma.event.delete({ where: { id: eventId } });
  }
  await prisma.$disconnect();
});

async function createTestEvent(): Promise<number> {
  const cbtmEventId = randomInt(1_000_000_000, 2_000_000_000);
  const event = await prisma.event.create({
    data: {
      cbtmEventId,
      nome: `PP-055 TEST ${cbtmEventId}`,
      concluido: false,
    },
    select: { id: true },
  });
  testEventIds.push(event.id);
  return event.id;
}

test("T-I-02 grupo com uma linha permanece intacto", async () => {
  const eventId = await createTestEvent();
  const category = await prisma.category.create({
    data: {
      eventId,
      name: "ABSOLUTO A FEM",
      normalizedName: "absoluto a fem",
      cbtmCategoryId: "67",
    },
  });
  const original = await prisma.match.create({
    data: {
      eventId,
      categoryId: category.id,
      cbtmMatchId: "2",
      phase: "RESULTADOS",
      round: "Final",
      tableNumber: "17",
      matchDatetime: new Date("2026-09-18T14:30:00.000Z"),
      scoreRaw: "",
      fetchedAt: new Date("2026-09-18T12:00:00.000Z"),
      matchKey: `pp055-${eventId}-unico`,
    },
  });

  await runDuplicateMatchCleanup({ prisma, eventId, execute: true });

  const persisted = await prisma.match.findUniqueOrThrow({ where: { id: original.id } });
  assert.equal(persisted.id, original.id);
  assert.equal(persisted.updatedAt.toISOString(), original.updatedAt.toISOString());
});
