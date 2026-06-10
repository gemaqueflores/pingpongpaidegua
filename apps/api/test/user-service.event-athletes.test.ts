import assert from "node:assert/strict";
import test from "node:test";
import { UserController } from "../src/user/user.controller";
import { UserService } from "../src/user/user.service";

type EventScope = {
  canonicalEventId: number;
  allEventIds: number[];
  childSuffixByEventId: Map<number, string>;
};

type ScheduleService = UserService & {
  listEventSchedule(eventId: number): Promise<{
    eventId: number;
    categories: Array<{
      categoryId: number;
      categoryName: string;
      matches: Array<{
        id: number;
        matchDatetime: string | null;
        playerA: { id: number | null; name: string; clubName: string | null } | null;
        playerB: { id: number | null; name: string; clubName: string | null } | null;
      }>;
    }>;
  }>;
};

function createService(prisma: Record<string, unknown>, scope?: EventScope) {
  const service = new UserService(prisma as never, prisma as never) as UserService & {
    resolveEventScope(eventId: number): Promise<EventScope>;
    ensureEvent(eventId: number): Promise<Record<string, unknown>>;
    getStateCircuitEligibleClubIds(): Promise<Set<number>>;
    ensureStableAthleteRouteIds(
      athletes: Array<{
        eventId: number;
        athleteId: number;
        athleteName: string;
        athleteNameNormalized: string;
        clubNormalizedName: string | null;
      }>,
    ): Promise<Map<number, number>>;
    ensureCategoryOfEvent(eventIds: number[], categoryId: number): Promise<void>;
  };

  service.resolveEventScope = async (eventId: number) =>
    scope ?? {
      canonicalEventId: eventId,
      allEventIds: [eventId],
      childSuffixByEventId: new Map<number, string>(),
    };
  service.ensureEvent = async (eventId: number) => ({ id: eventId });
  service.getStateCircuitEligibleClubIds = async () => new Set([1, 2, 3]);
  service.ensureStableAthleteRouteIds = async (athletes) =>
    new Map(athletes.map((athlete) => [athlete.athleteId, athlete.athleteId]));
  service.ensureCategoryOfEvent = async () => undefined;

  return service;
}

function stringify(value: unknown): string {
  return JSON.stringify(value);
}

test("T-U-01 listAthletes inclui pares de duplas no evento", async () => {
  let whereArg: Record<string, unknown> | null = null;
  const prisma = {
    athlete: {
      async findMany(args: { where: Record<string, unknown> }) {
        whereArg = args.where;
        return [
          {
            id: 10,
            eventId: 51,
            nameDisplay: "ATLETA INDIVIDUAL",
            nameNormalized: "atleta individual",
            stateCode: "PA",
            region: "NORTE",
            club: { id: 1, name: "CLUBE A", normalizedName: "clube a" },
          },
          {
            id: 20,
            eventId: 52,
            nameDisplay: "SILVA A # SILVA B",
            nameNormalized: "silva a # silva b",
            stateCode: "PA",
            region: "NORTE",
            club: { id: 1, name: "CLUBE A", normalizedName: "clube a" },
          },
        ];
      },
    },
  };
  const service = createService(prisma, {
    canonicalEventId: 51,
    allEventIds: [51, 52, 53],
    childSuffixByEventId: new Map([
      [52, " - DUPLAS"],
      [53, " - DUPLAS MISTAS"],
    ]),
  });

  const result = await service.listAthletes(51, "");

  assert.ok(result.some((athlete) => athlete.nameDisplay.includes("#")));
  assert.ok(result.some((athlete) => !athlete.nameDisplay.includes("#")));
  assert.ok(!stringify(whereArg).includes('"contains":"#"'));
});

test("T-U-02 listAthleteDirectory mantem filtro de pares no diretorio global", async () => {
  const prisma = {
    athlete: {
      async findMany() {
        return [
          {
            id: 20,
            eventId: 52,
            nameDisplay: "SILVA A # SILVA B",
            nameNormalized: "silva a # silva b",
          },
        ];
      },
    },
    athleteCategory: {
      async findMany() {
        return [{ athleteId: 20, categoryId: 200 }];
      },
    },
    match: {
      async findMany() {
        return [];
      },
    },
  };
  const service = createService(prisma);

  const result = await service.listAthleteDirectory("");

  assert.equal(result.length, 0);
});

test("T-U-03 listClubs inclui pares na contagem de atletas do clube", async () => {
  let athletesByClubWhere: Record<string, unknown> | null = null;
  const prisma = {
    club: {
      async findMany() {
        return [{ id: 1, name: "CLUBE A" }];
      },
    },
    athlete: {
      async findMany(args: { where: Record<string, unknown> }) {
        athletesByClubWhere = args.where;
        return [
          { clubId: 1, nameNormalized: "atleta individual 1" },
          { clubId: 1, nameNormalized: "atleta individual 2" },
          { clubId: 1, nameNormalized: "atleta individual 3" },
          { clubId: 1, nameNormalized: "silva a # silva b" },
          { clubId: 1, nameNormalized: "dupla mista a # dupla mista b" },
        ];
      },
    },
  };
  const service = createService(prisma, {
    canonicalEventId: 51,
    allEventIds: [51, 52, 53],
    childSuffixByEventId: new Map([
      [52, " - DUPLAS"],
      [53, " - DUPLAS MISTAS"],
    ]),
  });

  const result = await service.listClubs(51, "", null);

  assert.equal(result[0]?.athleteCount, 5);
  assert.ok(!stringify(athletesByClubWhere).includes('"contains":"#"'));
});

test("T-U-04 listClubAthletes retorna pares do clube", async () => {
  let athleteWhereArg: Record<string, unknown> | null = null;
  const prisma = {
    club: {
      async findFirst() {
        return { id: 1, name: "CLUBE A", normalizedName: "clube a" };
      },
    },
    athlete: {
      async findMany(args: { where: Record<string, unknown> }) {
        athleteWhereArg = args.where;
        return [
          {
            id: 20,
            eventId: 52,
            nameDisplay: "SILVA A # SILVA B",
            nameNormalized: "silva a # silva b",
            stateCode: "PA",
            region: "NORTE",
            categories: [
              {
                registrationStatus: "INSCRITO",
                category: { id: 200, eventId: 52, name: "ABSOLUTO A" },
              },
            ],
          },
        ];
      },
    },
  };
  const service = createService(prisma, {
    canonicalEventId: 51,
    allEventIds: [51, 52, 53],
    childSuffixByEventId: new Map([
      [52, " - DUPLAS"],
      [53, " - DUPLAS MISTAS"],
    ]),
  });

  const result = await service.listClubAthletes(51, 1, null);

  assert.equal(result.athletes[0]?.nameDisplay, "SILVA A # SILVA B");
  assert.deepEqual(result.athletes[0]?.categoryNames, ["ABSOLUTO A - DUPLAS"]);
  assert.ok(!stringify(athleteWhereArg).includes('"contains":"#"'));
});

test("T-U-05 listEventSchedule retorna partidas agrupadas por categoria com sufixo e ordenacao", async () => {
  const prisma = {
    match: {
      async findMany() {
        return [
          {
            id: 2,
            eventId: 52,
            categoryId: 200,
            round: "Grupo 01",
            tableNumber: "2",
            matchDatetime: null,
            scoreRaw: "",
            scorePlayers: [
              { name: "PAR SEM HORA A", athleteId: 30 },
              { name: "PAR SEM HORA B", athleteId: 40 },
            ],
            category: { id: 200, eventId: 52, name: "ABSOLUTO A", cbtmCategoryId: "200" },
            participants: [
              { athleteId: 30, athlete: { id: 30, nameDisplay: "PAR SEM HORA A", club: { id: 1, name: "CLUBE A" } } },
              { athleteId: 40, athlete: { id: 40, nameDisplay: "PAR SEM HORA B", club: { id: 2, name: "CLUBE B" } } },
            ],
          },
          {
            id: 1,
            eventId: 52,
            categoryId: 200,
            round: "Grupo 01",
            tableNumber: "1",
            matchDatetime: new Date("2026-06-14T12:00:00.000Z"),
            scoreRaw: "3-1",
            scorePlayers: [
              { name: "SILVA A # SILVA B", athleteId: 10 },
              { name: "LIMA A # LIMA B", athleteId: 20 },
            ],
            category: { id: 200, eventId: 52, name: "ABSOLUTO A", cbtmCategoryId: "200" },
            participants: [
              { athleteId: 10, athlete: { id: 10, nameDisplay: "SILVA A # SILVA B", club: { id: 1, name: "CLUBE A" } } },
              { athleteId: 20, athlete: { id: 20, nameDisplay: "LIMA A # LIMA B", club: { id: 2, name: "CLUBE B" } } },
            ],
          },
          {
            id: 3,
            eventId: 53,
            categoryId: 300,
            round: "Final",
            tableNumber: "3",
            matchDatetime: new Date("2026-06-14T13:00:00.000Z"),
            scoreRaw: null,
            scorePlayers: null,
            category: { id: 300, eventId: 53, name: "DUPLA MISTA", cbtmCategoryId: "300" },
            participants: [
              { athleteId: 50, athlete: { id: 50, nameDisplay: "MISTA A # MISTA B", club: { id: 1, name: "CLUBE A" } } },
              { athleteId: 60, athlete: { id: 60, nameDisplay: "MISTA C # MISTA D", club: { id: 2, name: "CLUBE B" } } },
            ],
          },
        ];
      },
    },
  };
  const service = createService(prisma, {
    canonicalEventId: 51,
    allEventIds: [51, 52, 53],
    childSuffixByEventId: new Map([
      [52, " - DUPLAS"],
      [53, " - DUPLAS MISTAS"],
    ]),
  }) as ScheduleService;

  const result = await service.listEventSchedule(51);

  assert.equal(result.eventId, 51);
  assert.deepEqual(
    result.categories.map((category) => category.categoryName),
    ["ABSOLUTO A - DUPLAS", "DUPLA MISTA - DUPLAS MISTAS"],
  );
  assert.deepEqual(
    result.categories[0]?.matches.map((match) => match.id),
    [1, 2],
  );
  assert.equal(result.categories[0]?.matches[0]?.matchDatetime, "2026-06-14T12:00:00.000Z");
  assert.equal(result.categories[0]?.matches[0]?.playerA?.name, "SILVA A # SILVA B");
});

test("T-U-06 listEventSchedule ignora categorias sem partidas e categorias ignoradas", async () => {
  const prisma = {
    match: {
      async findMany() {
        return [
          {
            id: 1,
            eventId: 51,
            categoryId: 100,
            round: "Grupo 01",
            tableNumber: "1",
            matchDatetime: null,
            scoreRaw: "",
            scorePlayers: null,
            category: { id: 100, eventId: 51, name: "ABSOLUTO A", cbtmCategoryId: "100" },
            participants: [
              { athleteId: 10, athlete: { id: 10, nameDisplay: "ATLETA A", club: { id: 1, name: "CLUBE A" } } },
              { athleteId: 20, athlete: { id: 20, nameDisplay: "ATLETA B", club: { id: 2, name: "CLUBE B" } } },
            ],
          },
          {
            id: 2,
            eventId: 51,
            categoryId: 999,
            round: "Grupo 01",
            tableNumber: "2",
            matchDatetime: null,
            scoreRaw: "",
            scorePlayers: null,
            category: { id: 999, eventId: 51, name: "IGNORADA", cbtmCategoryId: "88888888" },
            participants: [],
          },
        ];
      },
    },
  };
  const service = createService(prisma) as ScheduleService;

  const result = await service.listEventSchedule(51);

  assert.deepEqual(
    result.categories.map((category) => category.categoryName),
    ["ABSOLUTO A"],
  );
});

test("T-I-01 controller GET events/:id/athletes inclui pares", async () => {
  const controller = new UserController({
    async listAthletes(eventId: number) {
      assert.equal(eventId, 51);
      return [
        {
          id: 20,
          rawAthleteId: 20,
          nameDisplay: "SILVA A # SILVA B",
          stateCode: "PA",
          region: "NORTE",
          club: { id: 1, name: "CLUBE A" },
        },
      ];
    },
  } as unknown as UserService);

  const response = await controller.listAthletes(51, "", undefined, undefined);

  assert.ok(response.some((athlete) => athlete.nameDisplay.includes("#")));
});

test("T-I-02 controller GET events/:id/schedule retorna estrutura correta", async () => {
  const controller = new UserController({
    async listEventSchedule(eventId: number) {
      assert.equal(eventId, 51);
      return {
        eventId,
        categories: [
          {
            categoryId: 200,
            categoryName: "ABSOLUTO A - DUPLAS",
            matches: [
              {
                id: 1,
                round: "Grupo 01",
                tableNumber: "1",
                matchDatetime: "2026-06-14T12:00:00.000Z",
                scoreRaw: null,
                playerA: { id: 10, name: "SILVA A # SILVA B", clubName: "CLUBE A" },
                playerB: { id: 20, name: "LIMA A # LIMA B", clubName: "CLUBE B" },
              },
            ],
          },
        ],
      };
    },
  } as unknown as UserService) as UserController & {
    listEventSchedule(eventId: number): Promise<{
      eventId: number;
      categories: Array<{ matches: Array<{ matchDatetime: string | null }> }>;
    }>;
  };

  const response = await controller.listEventSchedule(51);

  assert.equal(response.eventId, 51);
  assert.ok(response.categories[0]?.matches[0]?.matchDatetime);
});
