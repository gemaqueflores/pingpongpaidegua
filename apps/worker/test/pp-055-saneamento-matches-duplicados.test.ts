import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import test, { after } from "node:test";
import {
  parseArgs,
  runDuplicateMatchCleanup,
} from "../../../scripts/pp-055-saneamento-matches-duplicados";
import { prisma } from "../src/prisma";

const testEventIds: number[] = [];
const testClubIds: number[] = [];

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
  await prisma.club.deleteMany({ where: { id: { in: testClubIds } } });
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

async function createTestCategory(eventId: number, suffix = "A"): Promise<number> {
  const category = await prisma.category.create({
    data: {
      eventId,
      name: `ABSOLUTO ${suffix} FEM`,
      normalizedName: `absoluto ${suffix.toLowerCase()} fem`,
      cbtmCategoryId: suffix === "A" ? "67" : "68",
    },
    select: { id: true },
  });
  return category.id;
}

async function createMatch(input: {
  eventId: number;
  categoryId: number;
  cbtmMatchId: string;
  key: string;
  fetchedAt: string;
  tableNumber: string;
  scoreRaw?: string;
}) {
  return prisma.match.create({
    data: {
      eventId: input.eventId,
      categoryId: input.categoryId,
      cbtmMatchId: input.cbtmMatchId,
      phase: "RESULTADOS",
      round: "Final",
      tableNumber: input.tableNumber,
      matchDatetime: new Date(input.fetchedAt),
      scoreRaw: input.scoreRaw ?? "",
      fetchedAt: new Date(input.fetchedAt),
      matchKey: input.key,
    },
  });
}

async function createTestAthletes(eventId: number): Promise<number[]> {
  const club = await prisma.club.create({
    data: {
      name: `CLUBE PP055 ${eventId}`,
      normalizedName: `clube pp055 ${eventId}`,
    },
  });
  testClubIds.push(club.id);
  const athletes = await Promise.all([
    prisma.athlete.create({
      data: {
        eventId,
        clubId: club.id,
        nameDisplay: "ATLETA A",
        nameNormalized: "atleta a",
      },
    }),
    prisma.athlete.create({
      data: {
        eventId,
        clubId: club.id,
        nameDisplay: "ATLETA B",
        nameNormalized: "atleta b",
      },
    }),
  ]);
  return athletes.map((athlete) => athlete.id);
}

test("CLI usa dry-run por padrao e exige event-id explicito", () => {
  assert.deepEqual(parseArgs(["--event-id", "59"]), { eventId: 59, execute: false });
  assert.deepEqual(parseArgs(["--event-id=59", "--execute"]), {
    eventId: 59,
    execute: true,
  });
  assert.throws(() => parseArgs([]), /--event-id|Uso:/i);
  assert.throws(() => parseArgs(["--event-id", "0"]), /--event-id|Uso:/i);
  assert.throws(() => parseArgs(["--event-id", "59", "--desconhecido"]), /desconhecido/i);
});

test("T-I-02 grupo com uma linha permanece intacto", async () => {
  const eventId = await createTestEvent();
  const categoryId = await createTestCategory(eventId);
  const original = await createMatch({
    eventId,
    categoryId,
    cbtmMatchId: "2",
    key: `pp055-${eventId}-unico`,
    fetchedAt: "2026-09-18T12:00:00.000Z",
    tableNumber: "17",
  });

  await runDuplicateMatchCleanup({ prisma, eventId, execute: true });

  const persisted = await prisma.match.findUniqueOrThrow({ where: { id: original.id } });
  assert.equal(persisted.id, original.id);
  assert.equal(persisted.updatedAt.toISOString(), original.updatedAt.toISOString());
});

test("T-I-04 execucao fica isolada ao evento solicitado", async () => {
  const [targetEventId, otherEventId] = await Promise.all([
    createTestEvent(),
    createTestEvent(),
  ]);
  const [targetCategoryId, otherCategoryId] = await Promise.all([
    createTestCategory(targetEventId),
    createTestCategory(otherEventId),
  ]);
  await Promise.all([
    createMatch({
      eventId: targetEventId,
      categoryId: targetCategoryId,
      cbtmMatchId: "2",
      key: `pp055-${targetEventId}-antigo`,
      fetchedAt: "2026-09-18T10:00:00.000Z",
      tableNumber: "17",
    }),
    createMatch({
      eventId: targetEventId,
      categoryId: targetCategoryId,
      cbtmMatchId: "2",
      key: `pp055-${targetEventId}-novo`,
      fetchedAt: "2026-09-18T12:00:00.000Z",
      tableNumber: "19",
    }),
    createMatch({
      eventId: otherEventId,
      categoryId: otherCategoryId,
      cbtmMatchId: "2",
      key: `pp055-${otherEventId}-antigo`,
      fetchedAt: "2026-09-18T10:00:00.000Z",
      tableNumber: "17",
    }),
    createMatch({
      eventId: otherEventId,
      categoryId: otherCategoryId,
      cbtmMatchId: "2",
      key: `pp055-${otherEventId}-novo`,
      fetchedAt: "2026-09-18T12:00:00.000Z",
      tableNumber: "19",
    }),
  ]);

  await runDuplicateMatchCleanup({ prisma, eventId: targetEventId, execute: true });

  assert.equal(await prisma.match.count({ where: { eventId: targetEventId } }), 1);
  assert.equal(await prisma.match.count({ where: { eventId: otherEventId } }), 2);
});

test("T-I-01 dry-run relata duplicatas sem alterar o banco", async () => {
  const eventId = await createTestEvent();
  const categoryId = await createTestCategory(eventId);
  const [oldest, middle, latest] = await Promise.all([
    createMatch({
      eventId,
      categoryId,
      cbtmMatchId: "2",
      key: `pp055-${eventId}-dry-oldest`,
      fetchedAt: "2026-09-18T10:00:00.000Z",
      tableNumber: "17",
    }),
    createMatch({
      eventId,
      categoryId,
      cbtmMatchId: "002",
      key: `pp055-${eventId}-dry-middle`,
      fetchedAt: "2026-09-18T11:00:00.000Z",
      tableNumber: "18",
    }),
    createMatch({
      eventId,
      categoryId,
      cbtmMatchId: "2",
      key: `pp055-${eventId}-dry-latest`,
      fetchedAt: "2026-09-18T12:00:00.000Z",
      tableNumber: "19",
    }),
  ]);
  const before = await prisma.match.count({ where: { eventId } });

  const report = await runDuplicateMatchCleanup({ prisma, eventId, execute: false });

  assert.equal(await prisma.match.count({ where: { eventId } }), before);
  assert.equal(report.mode, "dry-run");
  assert.deepEqual(report.candidateRemovalMatchIds.sort((a, b) => a - b), [oldest.id, middle.id].sort((a, b) => a - b));
  assert.deepEqual(report.removedMatchIds, []);
  assert.equal(report.groups.length, 1);
  assert.equal(report.groups[0]?.status, "eligible");
  assert.equal(report.groups[0]?.cbtmMatchId, "2");
  assert.equal(report.groups[0]?.kept.id, latest.id);
  assert.deepEqual(
    report.groups[0]?.obsolete.map((match) => match.id).sort((a, b) => a - b),
    [oldest.id, middle.id].sort((a, b) => a - b),
  );
  assert.deepEqual(report.categories, [
    {
      categoryId,
      categoryName: "ABSOLUTO A FEM",
      before: 3,
      after: 3,
    },
  ]);
});

test("T-I-05 bloqueia remocao quando linha obsoleta possui placar", async () => {
  const eventId = await createTestEvent();
  const categoryId = await createTestCategory(eventId);
  await Promise.all([
    createMatch({
      eventId,
      categoryId,
      cbtmMatchId: "2",
      key: `pp055-${eventId}-placar-antigo`,
      fetchedAt: "2026-09-18T10:00:00.000Z",
      tableNumber: "17",
      scoreRaw: "3-1",
    }),
    createMatch({
      eventId,
      categoryId,
      cbtmMatchId: "2",
      key: `pp055-${eventId}-sem-placar-novo`,
      fetchedAt: "2026-09-18T12:00:00.000Z",
      tableNumber: "19",
      scoreRaw: "",
    }),
  ]);

  const report = await runDuplicateMatchCleanup({ prisma, eventId, execute: true });

  assert.equal(await prisma.match.count({ where: { eventId, categoryId } }), 2);
  assert.deepEqual(report.removedMatchIds, []);
  assert.equal(report.groups[0]?.status, "ambiguous");
  assert.match(report.groups[0]?.reason ?? "", /decisao manual/i);
});

test("T-I-03 remove obsoletas em transacao e invalida cache", async () => {
  const eventId = await createTestEvent();
  const categoryId = await createTestCategory(eventId);
  const athleteIds = await createTestAthletes(eventId);
  const [oldest, middle, latest] = await Promise.all([
    createMatch({
      eventId,
      categoryId,
      cbtmMatchId: "2",
      key: `pp055-${eventId}-execute-oldest`,
      fetchedAt: "2026-09-18T10:00:00.000Z",
      tableNumber: "17",
    }),
    createMatch({
      eventId,
      categoryId,
      cbtmMatchId: "2",
      key: `pp055-${eventId}-execute-middle`,
      fetchedAt: "2026-09-18T11:00:00.000Z",
      tableNumber: "18",
    }),
    createMatch({
      eventId,
      categoryId,
      cbtmMatchId: "2",
      key: `pp055-${eventId}-execute-latest`,
      fetchedAt: "2026-09-18T12:00:00.000Z",
      tableNumber: "19",
    }),
  ]);
  await prisma.matchParticipant.createMany({
    data: [oldest.id, middle.id, latest.id].flatMap((matchId) =>
      athleteIds.map((athleteId) => ({ matchId, athleteId })),
    ),
  });
  await prisma.readModelCache.create({
    data: {
      key: `pp055-event-${eventId}`,
      kind: "event-schedule-v1",
      eventId,
      payload: { matches: [oldest.id, middle.id, latest.id] },
    },
  });
  const keeperParticipantsBefore = await prisma.matchParticipant.findMany({
    where: { matchId: latest.id },
    orderBy: { athleteId: "asc" },
  });

  const report = await runDuplicateMatchCleanup({ prisma, eventId, execute: true });

  const remaining = await prisma.match.findMany({ where: { eventId, categoryId } });
  assert.deepEqual(remaining.map((match) => match.id), [latest.id]);
  assert.equal(
    await prisma.matchParticipant.count({
      where: { matchId: { in: [oldest.id, middle.id] } },
    }),
    0,
  );
  assert.deepEqual(
    await prisma.matchParticipant.findMany({
      where: { matchId: latest.id },
      orderBy: { athleteId: "asc" },
    }),
    keeperParticipantsBefore,
  );
  assert.equal(await prisma.readModelCache.count({ where: { eventId } }), 0);
  assert.deepEqual(report.removedMatchIds.sort((a, b) => a - b), [oldest.id, middle.id].sort((a, b) => a - b));
  assert.equal(report.cacheInvalidated, true);
});
