import assert from "node:assert/strict";
import test from "node:test";
import { UserService } from "../src/user/user.service";

test("historical group preferences exclui todos os eventIds do agregado atual", async () => {
  let categoryWhereArg: Record<string, unknown> | null = null;

  const prisma = {
    category: {
      async findMany(args: { where: Record<string, unknown> }) {
        categoryWhereArg = args.where;
        return [];
      },
    },
  };

  const service = new UserService(prisma as never, prisma as never) as UserService & {
    inferHistoricalGroupPreferences(input: {
      excludedEventIds: number[];
      categories: Array<{ id: number; normalizedName: string }>;
      athleteCountByCategory: Map<number, number>;
    }): Promise<Map<number, { preferredGroupCount: number | null; sampleSize: number }>>;
  };

  const result = await service.inferHistoricalGroupPreferences({
    excludedEventIds: [44, 45, 46],
    categories: [
      {
        id: 100,
        normalizedName: "absoluto c",
      },
    ],
    athleteCountByCategory: new Map([[100, 8]]),
  });

  assert.deepEqual((categoryWhereArg?.eventId as { notIn?: number[] })?.notIn, [44, 45, 46]);
  assert.deepEqual(result.get(100), { preferredGroupCount: null, sampleSize: 0 });
});

test("simulateGroups em evento agregado aplica sufixo do child event nas categorias simuladas", async () => {
  const prisma = {
    category: {
      async findMany() {
        return [
          {
            id: 200,
            eventId: 45,
            name: "RATING OPEN",
            normalizedName: "rating open",
          },
        ];
      },
    },
    event: {
      async findMany() {
        return [{ id: 45, ratingMatchFormat: "K1" }];
      },
    },
    athleteCategory: {
      async findMany() {
        return [
          {
            categoryId: 200,
            registrationStatus: "INSCRITO",
            rankingPoints: 1000,
            ratingPoints: 1200,
            athlete: {
              id: 1,
              nameDisplay: "ATLETA 1",
              clubId: 1,
              club: { name: "CLUBE A" },
              rankingPoints: 1000,
              ratingPoints: 1200,
            },
          },
          {
            categoryId: 200,
            registrationStatus: "INSCRITO",
            rankingPoints: 990,
            ratingPoints: 1190,
            athlete: {
              id: 2,
              nameDisplay: "ATLETA 2",
              clubId: 2,
              club: { name: "CLUBE B" },
              rankingPoints: 990,
              ratingPoints: 1190,
            },
          },
          {
            categoryId: 200,
            registrationStatus: "INSCRITO",
            rankingPoints: 980,
            ratingPoints: 1180,
            athlete: {
              id: 3,
              nameDisplay: "ATLETA 3",
              clubId: 3,
              club: { name: "CLUBE C" },
              rankingPoints: 980,
              ratingPoints: 1180,
            },
          },
        ];
      },
    },
    match: {
      async findMany() {
        return [];
      },
    },
  };

  const service = new UserService(prisma as never, prisma as never) as UserService & {
    resolveEventScope(eventId: number): Promise<{
      canonicalEventId: number;
      allEventIds: number[];
      childSuffixByEventId: Map<number, string>;
    }>;
    ensureEvent(eventId: number): Promise<Record<string, unknown>>;
    readEventPublicationFlags(eventIds: number[]): Promise<{ hasPublishedMatches: boolean; hasPublishedResults: boolean }>;
    eventHasOfficialGroups(eventIds: number[]): Promise<boolean>;
    inferHistoricalGroupPreferences(input: {
      excludedEventIds: number[];
      categories: Array<{ id: number; normalizedName: string }>;
      athleteCountByCategory: Map<number, number>;
    }): Promise<Map<number, { preferredGroupCount: number | null; sampleSize: number }>>;
  };

  service.resolveEventScope = async (eventId: number) => ({
    canonicalEventId: eventId,
    allEventIds: [44, 45],
    childSuffixByEventId: new Map([[45, " - DUPLAS"]]),
  });
  service.ensureEvent = async (eventId: number) => ({
    id: eventId,
    concluido: false,
    inicioInscricoes: new Date("2099-04-01T00:00:00.000Z"),
    fimInscricoes: new Date("2099-04-20T00:00:00.000Z"),
    inicioRealizacao: new Date("2099-04-25T00:00:00.000Z"),
    fimRealizacao: new Date("2099-04-27T00:00:00.000Z"),
    dataInicio: new Date("2099-04-25T00:00:00.000Z"),
    dataFim: new Date("2099-04-27T00:00:00.000Z"),
  });
  service.readEventPublicationFlags = async () => ({
    hasPublishedMatches: false,
    hasPublishedResults: false,
  });
  service.eventHasOfficialGroups = async () => false;
  service.inferHistoricalGroupPreferences = async () => new Map([[200, { preferredGroupCount: 1, sampleSize: 2 }]]);

  const response = await service.simulateGroups(44, 200, "confirmed", false);

  assert.equal(response.categories.length, 1);
  assert.equal(response.categories[0]?.categoryName, "RATING OPEN - DUPLAS");
});
