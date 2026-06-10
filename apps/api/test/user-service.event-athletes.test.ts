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
