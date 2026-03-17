import assert from "node:assert/strict";
import test from "node:test";
import { UserService } from "../src/user/user.service";

function createAthleteSummaryHarness() {
  let cachedRecord:
    | {
        key: string;
        sourceScrapeRunId: number | null;
        payload: unknown;
        updatedAt: Date;
      }
    | null = null;
  let athleteFindFirstCalls = 0;
  let failAthleteLookup = false;

  const prismaRead = {
    readModelCache: {
      async findUnique({ where }: { where: { key: string } }) {
        if (cachedRecord && cachedRecord.key === where.key) {
          return {
            sourceScrapeRunId: cachedRecord.sourceScrapeRunId,
            payload: cachedRecord.payload,
            updatedAt: cachedRecord.updatedAt,
          };
        }
        return null;
      },
    },
    athlete: {
      async findFirst() {
        athleteFindFirstCalls += 1;
        if (failAthleteLookup) {
          throw new Error("forced athlete lookup failure");
        }
        return {
          id: 9001,
          eventId: 1,
          nameDisplay: "ATLETA TESTE",
          nameNormalized: "atleta teste",
          rankingPoints: 100,
          ratingPoints: 80,
          stateCode: "PA",
          stateName: "Para",
          region: "NORTE",
          club: {
            id: 77,
            name: "CLUBE TESTE",
          },
          categories: [
            {
              registrationStatus: "INSCRITO",
              category: {
                id: 10,
                eventId: 1,
                name: "ABSOLUTO E (MAS)",
                cbtmCategoryId: 111,
              },
            },
          ],
        };
      },
    },
    match: {
      async findMany() {
        return [];
      },
    },
  };

  const prismaWrite = {
    readModelCache: {
      async upsert(input: {
        where: { key: string };
        create: { key: string; sourceScrapeRunId: number | null; payload: unknown };
        update: { sourceScrapeRunId: number | null; payload: unknown };
      }) {
        cachedRecord = {
          key: input.where.key,
          sourceScrapeRunId: input.update.sourceScrapeRunId,
          payload: input.update.payload,
          updatedAt: new Date(),
        };
        return cachedRecord;
      },
    },
  };

  const service = new UserService(prismaRead as never, prismaWrite as never) as UserService & {
    resolveEventScope(eventId: number): Promise<{
      canonicalEventId: number;
      allEventIds: number[];
      childSuffixByEventId: Map<number, string>;
    }>;
    ensureEvent(eventId: number): Promise<Record<string, unknown>>;
    resolveAthleteRouteContext(
      scope: unknown,
      athleteId: number,
    ): Promise<{ routeAthleteId: number; rawAthleteId: number }>;
    getLatestReliableScrapeRunIdForScope(eventIds: number[]): Promise<number>;
  };

  service.resolveEventScope = async (eventId: number) => ({
    canonicalEventId: eventId,
    allEventIds: [eventId],
    childSuffixByEventId: new Map(),
  });
  service.ensureEvent = async (eventId: number) => ({
    id: eventId,
    cbtmEventId: 5368,
    nome: "1TMB26",
    nivel: "ESTADUAL",
    inicioInscricoes: new Date("2026-03-01T00:00:00.000Z"),
    fimInscricoes: new Date("2026-03-10T00:00:00.000Z"),
    inicioRealizacao: new Date("2026-03-20T00:00:00.000Z"),
    fimRealizacao: new Date("2026-03-21T00:00:00.000Z"),
    dataInicio: new Date("2026-03-20T00:00:00.000Z"),
    dataFim: new Date("2026-03-21T00:00:00.000Z"),
    concluido: false,
  });
  service.resolveAthleteRouteContext = async (_scope: unknown, athleteId: number) => ({
    routeAthleteId: athleteId,
    rawAthleteId: 9001,
  });
  service.getLatestReliableScrapeRunIdForScope = async () => 33;

  return {
    service,
    setCachedRecord(value: {
      key: string;
      sourceScrapeRunId: number | null;
      payload: unknown;
      updatedAt: Date;
    } | null) {
      cachedRecord = value;
    },
    setFailAthleteLookup(value: boolean) {
      failAthleteLookup = value;
    },
    getAthleteFindFirstCalls() {
      return athleteFindFirstCalls;
    },
  };
}

test("athlete summary persiste read model e reutiliza cache valido no mesmo scrape run", async () => {
  const harness = createAthleteSummaryHarness();

  const first = await harness.service.getAthleteSummary(1, 5001, "phase_hierarchy_datetime");
  assert.equal(first.event.id, 1);
  assert.equal(first.athlete.name, "ATLETA TESTE");
  assert.equal(first.categories.length, 1);
  assert.equal(first.matches.length, 0);
  assert.equal(harness.getAthleteFindFirstCalls(), 1);

  const second = await harness.service.getAthleteSummary(1, 5001, "phase_hierarchy_datetime");
  assert.deepEqual(second, first);
  assert.equal(harness.getAthleteFindFirstCalls(), 1);
});

test("athlete summary usa cache stale quando recomputacao falha", async () => {
  const harness = createAthleteSummaryHarness();
  harness.setCachedRecord({
    key: "athlete-summary|event:1|athlete:5001|variant:phase_hierarchy_datetime:v2",
    sourceScrapeRunId: 33,
    payload: {
      event: { id: 1, name: "1TMB26" },
      athlete: { id: 9001, name: "ATLETA CACHE" },
      club: { id: 77, name: "CLUBE CACHE" },
      categories: [],
      matches: [],
      performance: {
        pointsWon: 0,
        pointsPlayed: 0,
        ratio: null,
        setsUsed: 0,
        ignoredSets: 0,
        matchesConsidered: 0,
      },
      performanceByCategory: [],
      orderByApplied: "phase_hierarchy_datetime",
      deduplicatedMatchesRemoved: 0,
      noDatetimeFallback: "Jogos sem horario ficam no final da fase/rodada e sao desempatados por mesa e match_key.",
    },
    updatedAt: new Date("2000-01-01T00:00:00.000Z"),
  });
  harness.setFailAthleteLookup(true);

  const response = await harness.service.getAthleteSummary(1, 5001, "phase_hierarchy_datetime");
  assert.equal(response.athlete.name, "ATLETA CACHE");
  assert.deepEqual(response._meta, {
    isStale: true,
    staleReason: "compute_failed",
  });
  assert.equal(harness.getAthleteFindFirstCalls(), 1);
});
