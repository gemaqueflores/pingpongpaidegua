import assert from "node:assert/strict";
import test from "node:test";
import { UserService } from "../src/user/user.service";

function createService(prisma: Record<string, unknown>) {
  const service = new UserService(prisma as never, prisma as never) as UserService & {
    resolveEventScope(eventId: number): Promise<{ canonicalEventId: number; allEventIds: number[] }>;
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

  service.resolveEventScope = async (eventId: number) => ({
    canonicalEventId: eventId,
    allEventIds: [eventId],
  });
  service.ensureEvent = async (eventId: number) => ({ id: eventId });
  service.getStateCircuitEligibleClubIds = async () => new Set([1, 2, 3]);
  service.ensureStableAthleteRouteIds = async (athletes) =>
    new Map(athletes.map((athlete) => [athlete.athleteId, athlete.athleteId]));
  service.ensureCategoryOfEvent = async () => undefined;

  return service;
}

test("listAthletes exige registrationStatus INSCRITO", async () => {
  let whereArg: Record<string, unknown> | null = null;
  const prisma = {
    athlete: {
      async findMany(args: { where: Record<string, unknown> }) {
        whereArg = args.where;
        return [];
      },
    },
  };

  const service = createService(prisma);
  await service.listAthletes(44, "");

  assert.equal(
    ((whereArg?.categories as { some?: { registrationStatus?: string } })?.some?.registrationStatus ?? null),
    "INSCRITO",
  );
});

test("listClubs exige registrationStatus INSCRITO no filtro principal e na contagem por clube", async () => {
  const clubWhereArgs: Array<Record<string, unknown>> = [];
  const athleteWhereArgs: Array<Record<string, unknown>> = [];
  const prisma = {
    club: {
      async findMany(args: { where: Record<string, unknown> }) {
        clubWhereArgs.push(args.where);
        return [{ id: 1, name: "CLUBE A" }];
      },
    },
    athlete: {
      async findMany(args: { where: Record<string, unknown> }) {
        athleteWhereArgs.push(args.where);
        return [{ clubId: 1, nameNormalized: "atleta a" }];
      },
    },
  };

  const service = createService(prisma);
  const result = await service.listClubs(44, "", null);

  assert.equal(result.length, 1);
  assert.equal(
    (((clubWhereArgs[0]?.athletes as { some?: { categories?: { some?: { registrationStatus?: string } } } })?.some
      ?.categories as { some?: { registrationStatus?: string } })?.some?.registrationStatus ?? null),
    "INSCRITO",
  );
  assert.equal(
    (((athleteWhereArgs[0]?.categories as { some?: { registrationStatus?: string } })?.some?.registrationStatus ??
      null)),
    "INSCRITO",
  );
});

test("listClubAthletes exige registrationStatus INSCRITO no lookup do clube e dos atletas", async () => {
  let clubWhereArg: Record<string, unknown> | null = null;
  let athleteWhereArg: Record<string, unknown> | null = null;
  const prisma = {
    club: {
      normalizedName: "clube-a",
      async findFirst(args: { where: Record<string, unknown> }) {
        clubWhereArg = args.where;
        return { id: 1, name: "CLUBE A", normalizedName: "clube-a" };
      },
    },
    athlete: {
      async findMany(args: { where: Record<string, unknown> }) {
        athleteWhereArg = args.where;
        return [
          {
            id: 10,
            eventId: 44,
            nameDisplay: "ATLETA A",
            nameNormalized: "atleta a",
            stateCode: "PA",
            region: "NORTE",
            categories: [
              {
                registrationStatus: "INSCRITO",
                category: {
                  id: 100,
                  eventId: 44,
                  name: "ABSOLUTO A",
                },
              },
            ],
          },
        ];
      },
    },
  };

  const service = createService(prisma);
  const result = await service.listClubAthletes(44, 1, null);

  assert.equal(result.athletes.length, 1);
  assert.equal(
    ((((clubWhereArg?.athletes as { some?: { categories?: { some?: { registrationStatus?: string } } } })?.some
      ?.categories as { some?: { registrationStatus?: string } })?.some?.registrationStatus ?? null)),
    "INSCRITO",
  );
  assert.equal(
    (((athleteWhereArg?.categories as { some?: { registrationStatus?: string } })?.some?.registrationStatus ??
      null)),
    "INSCRITO",
  );
});
