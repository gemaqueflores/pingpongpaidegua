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
  let matchFindManyCalls = 0;
  let matchFindManyImpl: (() => Promise<unknown[]>) | null = null;

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
        matchFindManyCalls += 1;
        if (matchFindManyImpl) {
          return matchFindManyImpl();
        }
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
    allEventIds: [eventId, 2],
    childSuffixByEventId: new Map([[2, " - DUPLAS MISTAS"]]),
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
    setMatchFindManyImpl(value: (() => Promise<unknown[]>) | null) {
      matchFindManyImpl = value;
    },
    getMatchFindManyCalls() {
      return matchFindManyCalls;
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

test("athlete summary mantém jogos projetados de dupla sem poluir performance por categoria do atleta individual", async () => {
  const harness = createAthleteSummaryHarness();

  let phase = 0;
  harness.setMatchFindManyImpl(async () => {
    phase += 1;
    if (phase === 1) {
      return [
        {
          id: 501,
          eventId: 1,
          categoryId: 10,
          cbtmMatchId: null,
          phase: "RESULTADOS",
          round: "Grupo 01",
          tableNumber: "1",
          matchDatetime: new Date("2026-03-20T10:00:00.000Z"),
          scoreRaw: "3-1",
          setsJson: [
            { p1: 11, p2: 7 },
            { p1: 11, p2: 8 },
            { p1: 9, p2: 11 },
            { p1: 11, p2: 6 },
          ],
          scoreFinal: { setsA: 3, setsB: 1 },
          scoreSets: [
            { set: 1, a: 11, b: 7 },
            { set: 2, a: 11, b: 8 },
            { set: 3, a: 9, b: 11 },
            { set: 4, a: 11, b: 6 },
          ],
          sourceFlags: null,
          p1Sets: 3,
          p2Sets: 1,
          winnerIndex: 0,
          scorePlayers: [
            { athleteId: 9001, name: "ATLETA TESTE" },
            { athleteId: 9002, name: "OPONENTE TESTE" },
          ],
          sourceUrl: "https://example.test/1",
          fetchedAt: new Date("2026-03-20T10:05:00.000Z"),
          matchKey: "m1",
          event: {
            id: 1,
            cbtmEventId: 5368,
            nome: "1TMB26",
            nivel: "ESTADUAL",
            dataInicio: new Date("2026-03-20T00:00:00.000Z"),
            dataFim: new Date("2026-03-21T00:00:00.000Z"),
            concluido: false,
          },
          category: {
            id: 10,
            name: "ABSOLUTO E (MAS)",
            cbtmCategoryId: "111",
          },
          participants: [
            {
              athleteId: 9001,
              athlete: {
                id: 9001,
                nameDisplay: "ATLETA TESTE",
                club: { id: 77, name: "CLUBE TESTE" },
              },
            },
            {
              athleteId: 9002,
              athlete: {
                id: 9002,
                nameDisplay: "OPONENTE TESTE",
                club: { id: 88, name: "CLUBE OPONENTE" },
              },
            },
          ],
        },
      ];
    }

    if (phase === 2) {
      return [
        {
          id: 601,
          eventId: 2,
          categoryId: 20,
          cbtmMatchId: null,
          phase: "RESULTADOS",
          round: "Única 01",
          tableNumber: "2",
          matchDatetime: new Date("2026-03-20T11:00:00.000Z"),
          scoreRaw: "3-0",
          setsJson: [
            { p1: 11, p2: 6 },
            { p1: 11, p2: 7 },
            { p1: 11, p2: 8 },
          ],
          scoreFinal: { setsA: 3, setsB: 0 },
          scoreSets: [
            { set: 1, a: 11, b: 6 },
            { set: 2, a: 11, b: 7 },
            { set: 3, a: 11, b: 8 },
          ],
          sourceFlags: null,
          p1Sets: 3,
          p2Sets: 0,
          winnerIndex: 0,
          scorePlayers: [
            { athleteId: null, name: "ATLETA TESTE - PARCEIRO TESTE" },
            { athleteId: null, name: "DUPLA OPONENTE A - DUPLA OPONENTE B" },
          ],
          sourceUrl: "https://example.test/2",
          fetchedAt: new Date("2026-03-20T11:05:00.000Z"),
          matchKey: "m2",
          event: {
            id: 2,
            cbtmEventId: 5369,
            nome: "1TMB26 - DUPLAS MISTAS",
            nivel: "ESTADUAL",
            dataInicio: new Date("2026-03-20T00:00:00.000Z"),
            dataFim: new Date("2026-03-21T00:00:00.000Z"),
            concluido: false,
          },
          category: {
            id: 20,
            name: "DUPLA MISTA-ABSOLUTO E - DUPLAS MISTAS",
            cbtmCategoryId: "316",
          },
          participants: [
            {
              athleteId: 9901,
              athlete: {
                id: 9901,
                nameDisplay: "ATLETA TESTE # PARCEIRO TESTE",
                club: { id: 77, name: "CLUBE TESTE" },
              },
            },
            {
              athleteId: 9902,
              athlete: {
                id: 9902,
                nameDisplay: "DUPLA OPONENTE A # DUPLA OPONENTE B",
                club: { id: 89, name: "OUTRO CLUBE" },
              },
            },
          ],
        },
      ];
    }

    return [
      {
        id: 501,
        eventId: 1,
        categoryId: 10,
        cbtmMatchId: null,
        phase: "RESULTADOS",
        round: "Grupo 01",
        tableNumber: "1",
        matchDatetime: new Date("2026-03-20T10:00:00.000Z"),
        scoreRaw: "3-1",
        setsJson: [
          { p1: 11, p2: 7 },
          { p1: 11, p2: 8 },
          { p1: 9, p2: 11 },
          { p1: 11, p2: 6 },
        ],
        scoreFinal: { setsA: 3, setsB: 1 },
        scoreSets: [
          { set: 1, a: 11, b: 7 },
          { set: 2, a: 11, b: 8 },
          { set: 3, a: 9, b: 11 },
          { set: 4, a: 11, b: 6 },
        ],
        sourceFlags: null,
        p1Sets: 3,
        p2Sets: 1,
        winnerIndex: 0,
        scorePlayers: [
          { athleteId: 9001, name: "ATLETA TESTE" },
          { athleteId: 9002, name: "OPONENTE TESTE" },
        ],
        sourceUrl: "https://example.test/1",
        fetchedAt: new Date("2026-03-20T10:05:00.000Z"),
        matchKey: "m1",
        category: {
          id: 10,
          name: "ABSOLUTO E (MAS)",
          cbtmCategoryId: "111",
        },
        participants: [
          {
            athleteId: 9001,
            athlete: {
              id: 9001,
              nameDisplay: "ATLETA TESTE",
              club: { id: 77, name: "CLUBE TESTE" },
            },
          },
          {
            athleteId: 9002,
            athlete: {
              id: 9002,
              nameDisplay: "OPONENTE TESTE",
              club: { id: 88, name: "CLUBE OPONENTE" },
            },
          },
        ],
      },
    ];
  });

  const response = await harness.service.getAthleteSummary(1, 5001, "phase_hierarchy_datetime");

  assert.equal(response.matches.length, 2);
  assert.equal(response.performance.matchesConsidered, 1);
  assert.equal(response.performanceByCategory?.length, 1);
  assert.equal(response.performanceByCategory?.[0]?.categoryId, 10);
  assert.equal(
    response.matches.some((match) => match.category.id === 20),
    true,
  );
});
