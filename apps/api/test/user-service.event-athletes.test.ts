import assert from "node:assert/strict";
import test from "node:test";
import { UserController } from "../src/user/user.controller";
import { UserService } from "../src/user/user.service";

type EventScope = {
  canonicalEventId: number;
  allEventIds: number[];
  childSuffixByEventId: Map<number, string>;
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
