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
  let categoryFindManyCalls = 0;

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
      async findMany() {
        categoryFindManyCalls += 1;
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
    listEvents(): Promise<Array<Record<string, unknown>>>;
    resolveEventScope(eventId: number): Promise<{ canonicalEventId: number; allEventIds: number[] }>;
    resolveEventScopeByCanonical(eventId: number): Promise<{ canonicalEventId: number; allEventIds: number[] }>;
    loadEventMerges(): Promise<Array<{ canonicalEventId: number; secondaryEventId: number; secondarySuffix: string | null }>>;
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
  service.resolveEventScopeByCanonical = async (eventId: number) => ({
    canonicalEventId: eventId,
    allEventIds: [eventId],
  });
  service.loadEventMerges = async () => [];
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
    getCategoryFindManyCalls: () => categoryFindManyCalls,
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

  const categoryCallsAfterFirst = harness.getCategoryFindManyCalls();
  assert.ok(categoryCallsAfterFirst > 0);

  const second = await harness.service.getEventSummary(1);
  assert.deepEqual(second, first);
  assert.equal(harness.getCategoryFindManyCalls(), categoryCallsAfterFirst);
});

test("event list e event summary usam a mesma agregacao para o mesmo evento", async () => {
  const harness = createServiceHarness();

  const [listEntry] = await harness.service.listEvents();
  const summary = await harness.service.getEventSummary(1);

  assert.ok(listEntry);
  assert.equal(listEntry.totalCategorias, summary.totalCategorias);
  assert.equal(listEntry.totalInscritos, summary.totalInscritos);
  assert.equal(listEntry.totalPartidasPrevistas, summary.totalPartidasPrevistas);
  assert.equal(listEntry.totalPartidasPublicadas, summary.totalPartidasPublicadas);
  assert.equal(listEntry.totalPartidasWo, summary.totalPartidasWo);
  assert.equal(listEntry.totalPartidasJogadas, summary.totalPartidasJogadas);
  assert.equal(listEntry.inscricoesTotaisOficiais, summary.inscricoesTotaisOficiais);
  assert.equal(listEntry.associacoesAtletaCategoria, summary.associacoesAtletaCategoria);
  assert.equal(listEntry.associacoesTecnicoClube, summary.associacoesTecnicoClube);
  assert.equal(listEntry.participantesUnicos, summary.participantesUnicos);
});

test("escopo de evento agregado inclui filhos em vinculos encadeados", async () => {
  const service = new UserService(
    {
      eventMerge: {
        async findMany() {
          return [
            { id: 1, primaryEventId: 10, secondaryEventId: 11, categorySuffix: " - DUPLAS" },
            { id: 2, primaryEventId: 11, secondaryEventId: 12, categorySuffix: " - DUPLAS MISTAS" },
          ];
        },
      },
    } as never,
    {} as never,
  ) as UserService & {
    resolveEventScope(eventId: number): Promise<{
      canonicalEventId: number;
      allEventIds: number[];
      childSuffixByEventId: Map<number, string>;
    }>;
    resolveEventScopeByCanonical(eventId: number): Promise<{
      canonicalEventId: number;
      allEventIds: number[];
      childSuffixByEventId: Map<number, string>;
    }>;
  };

  const fromRoot = await service.resolveEventScopeByCanonical(10);
  assert.equal(fromRoot.canonicalEventId, 10);
  assert.deepEqual(fromRoot.allEventIds, [10, 11, 12]);
  assert.equal(fromRoot.childSuffixByEventId.get(11), " - DUPLAS");
  assert.equal(fromRoot.childSuffixByEventId.get(12), " - DUPLAS MISTAS");

  const fromGrandchild = await service.resolveEventScope(12);
  assert.equal(fromGrandchild.canonicalEventId, 10);
  assert.deepEqual(fromGrandchild.allEventIds, [10, 11, 12]);
});

test("escopo de evento agregado usa fallback deterministico em vinculo ciclico", async () => {
  const service = new UserService(
    {
      eventMerge: {
        async findMany() {
          return [
            { id: 1, primaryEventId: 11, secondaryEventId: 10, categorySuffix: " - A" },
            { id: 2, primaryEventId: 10, secondaryEventId: 11, categorySuffix: " - B" },
          ];
        },
      },
    } as never,
    {} as never,
  ) as UserService & {
    resolveEventScope(eventId: number): Promise<{
      canonicalEventId: number;
      allEventIds: number[];
    }>;
  };

  const fromFirst = await service.resolveEventScope(10);
  const fromSecond = await service.resolveEventScope(11);

  assert.equal(fromFirst.canonicalEventId, 10);
  assert.equal(fromSecond.canonicalEventId, 10);
  assert.deepEqual(fromFirst.allEventIds, [10, 11]);
  assert.deepEqual(fromSecond.allEventIds, [10, 11]);
});

test("official category audit seleciona o ultimo run com auditoria por evento sem depender do tamanho do lote", async () => {
  const service = new UserService(
    {
      scrapeRun: {
        async findMany() {
          const runs: Array<{ eventId: number; extractionStats: unknown }> = [];
          for (let index = 60; index >= 1; index -= 1) {
            runs.push({
              eventId: 1,
              extractionStats: {
                capture: {
                  categoriesDiscoveredAudit:
                    index === 1
                      ? [{ categoryId: "111", categoryName: "ABSOLUTO E (MAS)", valid: true, registeredCount: 4 }]
                      : [],
                },
              },
            });
          }
          for (let index = 60; index >= 1; index -= 1) {
            runs.push({
              eventId: 2,
              extractionStats: {
                capture: {
                  categoriesDiscoveredAudit:
                    index === 1
                      ? [{ categoryId: "222", categoryName: "ABSOLUTO F (MAS)", valid: true, registeredCount: 6 }]
                      : [],
                },
              },
            });
          }
          return runs;
        },
      },
    } as never,
    {} as never,
  ) as UserService & {
    loadLatestOfficialCategoryAuditByEvent(
      eventIds: number[],
    ): Promise<Map<number, Map<string, { categoryId: string; registeredCount: number | null }>>>;
  };

  const selected = await service.loadLatestOfficialCategoryAuditByEvent([1, 2]);
  assert.equal(selected.get(1)?.get("111")?.registeredCount, 4);
  assert.equal(selected.get(2)?.get("222")?.registeredCount, 6);
});
