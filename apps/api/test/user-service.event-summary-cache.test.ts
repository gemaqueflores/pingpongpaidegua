import assert from "node:assert/strict";
import test from "node:test";
import { UserService } from "../src/user/user.service";

function createServiceHarness() {
  let cachedRecord:
    | {
        key: string;
        sourceScrapeRunId: number | null;
        payload: unknown;
        updatedAt: Date;
      }
    | null = null;
  let categoryGroupByCalls = 0;

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
    category: {
      async groupBy() {
        categoryGroupByCalls += 1;
        return [{ eventId: 1, _count: { _all: 1 } }];
      },
      async findMany() {
        return [{ id: 10, eventId: 1, name: "ABSOLUTO E (MAS)", cbtmCategoryId: 111 }];
      },
    },
    match: {
      async groupBy(args: { by: string[]; where?: Record<string, unknown> }) {
        if (args.by[0] === "categoryId") {
          return [{ categoryId: 10, _count: { _all: 5 } }];
        }
        const whereText = JSON.stringify(args.where ?? {});
        if (whereText.includes('"winnerIndex"') || whereText.includes('"p1Sets"') || whereText.includes('"p2Sets"')) {
          return [{ eventId: 1, _count: { _all: 5 } }];
        }
        if (whereText.toLowerCase().includes("grupo")) {
          return [{ eventId: 1, _count: { _all: 2 } }];
        }
        return [{ eventId: 1, _count: { _all: 5 } }];
      },
    },
    event: {
      async findMany() {
        return [
          {
            id: 1,
            lastScrapeAt: new Date("2026-03-09T10:00:00.000Z"),
            dataInicio: new Date("2026-03-20T00:00:00.000Z"),
            inicioRealizacao: new Date("2026-03-20T00:00:00.000Z"),
            ratingMatchFormat: "RR_K1",
          },
        ];
      },
    },
    athleteCategory: {
      async groupBy() {
        return [{ categoryId: 10, _count: { _all: 4 } }];
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
    resolveEventScope(eventId: number): Promise<{ canonicalEventId: number; allEventIds: number[] }>;
    ensureEvent(eventId: number): Promise<Record<string, unknown>>;
    getLatestReliableScrapeRunIdForScope(eventIds: number[]): Promise<number>;
    loadEventRegistrationMetrics(eventIds: number[]): Promise<{
      athleteCategoryAssociationsByEvent: Map<number, number>;
      tecnicoClubAssociationsByEvent: Map<number, number>;
      participantNamesByEvent: Map<number, Set<string>>;
    }>;
    loadLatestOfficialCategoryAuditByEvent(eventIds: number[]): Promise<Map<number, Map<string, any>>>;
    countWalkoversByCategoryIds(eventIds: number[], categoryIds: number[]): Promise<Map<number, number>>;
  };

  service.resolveEventScope = async (eventId: number) => ({
    canonicalEventId: eventId,
    allEventIds: [eventId],
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
  service.getLatestReliableScrapeRunIdForScope = async () => 99;
  service.loadEventRegistrationMetrics = async () => ({
    athleteCategoryAssociationsByEvent: new Map([[1, 4]]),
    tecnicoClubAssociationsByEvent: new Map([[1, 0]]),
    participantNamesByEvent: new Map([[1, new Set(["atleta a", "atleta b", "atleta c", "atleta d"])]]),
  });
  service.loadLatestOfficialCategoryAuditByEvent = async () =>
    new Map([
      [
        1,
        new Map([
          [
            "111",
            {
              categoryId: "111",
              categoryName: "ABSOLUTO E (MAS)",
              valid: true,
              registeredCount: 4,
              preRegisteredCount: 0,
              totalListedCount: 4,
              officialMatchesCount: 6,
            },
          ],
        ]),
      ],
    ]);
  service.countWalkoversByCategoryIds = async () => new Map([[10, 1]]);

  return {
    service,
    getCategoryGroupByCalls: () => categoryGroupByCalls,
  };
}

test("event summary persiste read model e reutiliza cache valido no mesmo scrape run", async () => {
  const harness = createServiceHarness();

  const first = await harness.service.getEventSummary(1);
  assert.equal(first.totalCategorias, 1);
  assert.equal(first.totalInscritos, 4);
  assert.equal(first.totalPartidasPrevistas, 6);
  assert.equal(first.totalPartidasPublicadas, 5);
  assert.equal(first.totalPartidasWo, 1);
  assert.equal(first.totalPartidasJogadas, 4);

  const categoryCallsAfterFirst = harness.getCategoryGroupByCalls();
  assert.ok(categoryCallsAfterFirst > 0);

  const second = await harness.service.getEventSummary(1);
  assert.deepEqual(second, first);
  assert.equal(harness.getCategoryGroupByCalls(), categoryCallsAfterFirst);
});
