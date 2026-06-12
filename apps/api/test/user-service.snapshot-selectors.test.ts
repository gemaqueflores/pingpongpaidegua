import assert from "node:assert/strict";
import test from "node:test";
import { NotFoundException } from "@nestjs/common";
import { UserService } from "../src/user/user.service";

function createSnapshotService(
  records: Map<string, Record<string, unknown>>,
  options: {
    scope?: { canonicalEventId: number; allEventIds: number[]; childSuffixByEventId: Map<number, string> };
    lockedEvents?: Array<{ scrapeLockedAt: Date | null }>;
  } = {},
) {
  const service = new UserService(
    {
      readModelCache: {
        async findUnique({ where }: { where: { key: string } }) {
          const payload = records.get(where.key);
          return payload
            ? {
                sourceScrapeRunId: 99,
                payload,
                updatedAt: new Date(),
              }
            : null;
        },
      },
      event: {
        async findMany() {
          return options.lockedEvents ?? [];
        },
      },
    } as never,
    {} as never,
  ) as UserService & {
    resolveEventScope(eventId: number): Promise<{ canonicalEventId: number; allEventIds: number[]; childSuffixByEventId: Map<number, string> }>;
    ensureEvent(eventId: number): Promise<Record<string, unknown>>;
    getLatestReliableScrapeRunIdForScope(eventIds: number[]): Promise<number>;
  };

  service.resolveEventScope = async (eventId: number) =>
    options.scope ?? {
      canonicalEventId: eventId,
      allEventIds: [eventId],
      childSuffixByEventId: new Map(),
    };
  service.ensureEvent = async () => ({
    concluido: false,
    scrapeLockedAt: null,
    inicioInscricoes: new Date("2026-06-01T00:00:00.000Z"),
    fimInscricoes: new Date("2026-06-10T00:00:00.000Z"),
    inicioRealizacao: new Date("2026-06-20T00:00:00.000Z"),
    fimRealizacao: new Date("2026-06-21T00:00:00.000Z"),
    dataInicio: new Date("2026-06-20T00:00:00.000Z"),
    dataFim: new Date("2026-06-21T00:00:00.000Z"),
  });
  service.getLatestReliableScrapeRunIdForScope = async () => 99;
  return service;
}

test("T-U-05 selector de atletas preserva busca, ordenacao e paginacao", async () => {
  const records = new Map<string, Record<string, unknown>>([
    [
      "event-athletes-v1|event:1",
      {
        eventId: 1,
        items: [
          athlete(1, "Álvaro Silva"),
          athlete(2, "Bruno Souza"),
          athlete(3, "Carla Lima"),
          athlete(4, "Davi Costa"),
          athlete(5, "Érica Santos"),
        ],
      },
    ],
  ]);
  const service = createSnapshotService(records);

  const pageOne = await service.listAthletes(1, "", "1", "2");
  const search = await service.listAthletes(1, "alvaro", "1", "10");
  const empty = await service.listAthletes(1, "zzz", "1", "10");

  assert.deepEqual(pageOne.map((item) => item.nameDisplay), ["Álvaro Silva", "Bruno Souza"]);
  assert.deepEqual(search.map((item) => item.nameDisplay), ["Álvaro Silva"]);
  assert.deepEqual(empty, []);
  assert.equal(search[0].id, 1001);
});

test("T-U-06 selector de clubes conta atleta multi-categoria uma vez", async () => {
  const service = createSnapshotService(clubRecords());

  const all = await service.listClubs(1, "", null);
  const filtered = await service.listClubs(1, "", 10);

  assert.equal(all.find((club) => club.id === 7)?.athleteCount, 2);
  assert.equal(filtered.find((club) => club.id === 7)?.athleteCount, 1);
  await assert.rejects(() => service.listClubs(1, "", 999), NotFoundException);
});

test("T-I-01 endpoints migrados servem espelho N durante mutacao simulada", async () => {
  const records = new Map<string, Record<string, unknown>>([
    [
      "event-athletes-v1|event:1",
      {
        eventId: 1,
        items: [athlete(1, "Atleta N")],
        _meta: { publishedAt: "2026-06-12T09:00:00.000Z" },
      },
    ],
    [
      "event-clubs-v1|event:1",
      {
        eventId: 1,
        clubs: [
          {
            id: 7,
            name: "Clube N",
            normalizedName: "clube n",
            athletes: [{ ...athlete(1, "Atleta N"), categoryIds: [10], categoryNames: ["Absoluto"] }],
          },
        ],
        _meta: { publishedAt: "2026-06-12T09:00:00.000Z" },
      },
    ],
    [
      "event-categories-v1|event:1",
      {
        eventId: 1,
        items: [{ id: 10, name: "Absoluto", eventId: 1 }],
        _meta: { publishedAt: "2026-06-12T09:00:00.000Z" },
      },
    ],
    [
      "event-schedule-v1|event:1",
      {
        eventId: 1,
        categories: [
          {
            categoryId: 10,
            categoryName: "Absoluto",
            matches: [{ id: 50, matchKey: "stable", scoreRaw: "3-0", playerA: null, playerB: null }],
          },
        ],
        _meta: { publishedAt: "2026-06-12T09:00:00.000Z" },
      },
    ],
  ]);
  const service = createSnapshotService(records, {
    scope: { canonicalEventId: 1, allEventIds: [1, 2], childSuffixByEventId: new Map([[2, " - B"]]) },
    lockedEvents: [{ scrapeLockedAt: new Date() }],
  });

  const athletes = await service.listAthletes(2, "", "1", "10");
  const clubs = await service.listClubs(2, "", null);
  const categories = await service.listCategories(2);
  const schedule = await service.listEventSchedule(2);

  assert.deepEqual(athletes.map((item) => item.nameDisplay), ["Atleta N"]);
  assert.deepEqual(clubs.map((item) => item.name), ["Clube N"]);
  assert.deepEqual(categories.map((item) => item.name), ["Absoluto"]);
  assert.deepEqual(schedule.categories[0].matches.map((item) => item.matchKey), ["stable"]);
});

test("T-U-07 listClubAthletes usa snapshot e preserva NotFound", async () => {
  const service = createSnapshotService(clubRecords());

  const valid = await service.listClubAthletes(1, 7, 10);
  assert.deepEqual(valid.athletes.map((item) => item.nameDisplay), ["Álvaro Silva"]);

  await assert.rejects(() => service.listClubAthletes(1, 999, null), NotFoundException);
  await assert.rejects(() => service.listClubAthletes(1, 7, 999), NotFoundException);
});

function athlete(id: number, nameDisplay: string) {
  return {
    id: id + 1000,
    rawAthleteId: id,
    eventId: 1,
    nameDisplay,
    nameNormalized: nameDisplay.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase(),
    stateCode: "PA",
    region: "Norte",
    club: { id: 7, name: "Clube A", normalizedName: "clube a" },
  };
}

function clubRecords() {
  return new Map<string, Record<string, unknown>>([
    [
      "event-clubs-v1|event:1",
      {
        eventId: 1,
        clubs: [
          {
            id: 7,
            name: "Clube A",
            normalizedName: "clube a",
            athletes: [
              {
                ...athlete(1, "Álvaro Silva"),
                categoryIds: [10, 11],
                categoryNames: ["Sub 19", "Absoluto"],
              },
              {
                ...athlete(2, "Bruno Souza"),
                categoryIds: [11],
                categoryNames: ["Absoluto"],
              },
            ],
          },
        ],
      },
    ],
  ]);
}
