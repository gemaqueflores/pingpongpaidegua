import assert from "node:assert/strict";
import test from "node:test";
import { NotFoundException } from "@nestjs/common";
import { UserService } from "../src/user/user.service";

function createSnapshotService(records: Map<string, Record<string, unknown>>) {
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
    } as never,
    {} as never,
  ) as UserService & {
    resolveEventScope(eventId: number): Promise<{ canonicalEventId: number; allEventIds: number[]; childSuffixByEventId: Map<number, string> }>;
    ensureEvent(eventId: number): Promise<Record<string, unknown>>;
    getLatestReliableScrapeRunIdForScope(eventIds: number[]): Promise<number>;
  };

  service.resolveEventScope = async (eventId: number) => ({
    canonicalEventId: eventId,
    allEventIds: [eventId],
    childSuffixByEventId: new Map(),
  });
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
