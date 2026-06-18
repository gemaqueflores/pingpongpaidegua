import assert from "node:assert/strict";
import test from "node:test";
import { UserService } from "../src/user/user.service";

function createServiceHarness(
  options: {
    publishedMatchesCount?: number;
    eventMetrics?: Array<{ eventId: number; categoryId: number; cbtmCategoryId: number; published: number }>;
    scopeEventIds?: number[];
    cachedRecord?: {
      key: string;
      sourceScrapeRunId: number | null;
      payload: unknown;
      updatedAt: Date;
    };
  } = {},
) {
  const eventMetrics = options.eventMetrics ?? [
    { eventId: 1, categoryId: 10, cbtmCategoryId: 111, published: options.publishedMatchesCount ?? 5 },
  ];
  const scopeEventIds = options.scopeEventIds ?? [1];
  const eventMetricsByCategoryId = new Map(eventMetrics.map((item) => [item.categoryId, item]));
  const publishedByEventId = new Map<number, number>();
  for (const item of eventMetrics) {
    publishedByEventId.set(item.eventId, (publishedByEventId.get(item.eventId) ?? 0) + item.published);
  }
  let cachedRecord:
    | {
        key: string;
        sourceScrapeRunId: number | null;
        payload: unknown;
        updatedAt: Date;
      }
    | null = options.cachedRecord ?? null;
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
        return eventMetrics.map((item) => ({
          id: item.categoryId,
          eventId: item.eventId,
          name: "ABSOLUTO E (MAS)",
          cbtmCategoryId: item.cbtmCategoryId,
        }));
      },
    },
    match: {
      async groupBy(args: { by: string[]; where?: Record<string, unknown> }) {
        if (args.by[0] === "categoryId") {
          return eventMetrics.map((item) => ({ categoryId: item.categoryId, _count: { _all: item.published } }));
        }
        const whereText = JSON.stringify(args.where ?? {});
        if (whereText.includes('"winnerIndex"') || whereText.includes('"p1Sets"') || whereText.includes('"p2Sets"')) {
          return [...publishedByEventId].map(([eventId, published]) => ({ eventId, _count: { _all: published } }));
        }
        if (whereText.toLowerCase().includes("grupo")) {
          return scopeEventIds.map((eventId) => ({ eventId, _count: { _all: 2 } }));
        }
        return [...publishedByEventId].map(([eventId, published]) => ({ eventId, _count: { _all: published } }));
      },
    },
    event: {
      async findMany() {
        return scopeEventIds.map((eventId) => ({
            id: eventId,
            lastScrapeAt: new Date("2026-03-09T10:00:00.000Z"),
            dataInicio: new Date("2026-03-20T00:00:00.000Z"),
            inicioRealizacao: new Date("2026-03-20T00:00:00.000Z"),
            ratingMatchFormat: "RR_K1",
        }));
      },
    },
    athleteCategory: {
      async groupBy() {
        return eventMetrics.map((item) => ({ categoryId: item.categoryId, _count: { _all: 4 } }));
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
    allEventIds: scopeEventIds,
  });
  service.resolveEventScopeByCanonical = async (eventId: number) => ({
    canonicalEventId: eventId,
    allEventIds: scopeEventIds,
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
    athleteCategoryAssociationsByEvent: new Map(scopeEventIds.map((eventId) => [eventId, 4])),
    tecnicoClubAssociationsByEvent: new Map(scopeEventIds.map((eventId) => [eventId, 0])),
    participantNamesByEvent: new Map(
      scopeEventIds.map((eventId) => [
        eventId,
        new Set([`atleta a ${eventId}`, `atleta b ${eventId}`, `atleta c ${eventId}`, `atleta d ${eventId}`]),
      ]),
    ),
  });
  service.loadLatestOfficialCategoryAuditByEvent = async () =>
    new Map(
      scopeEventIds.map((eventId) => [
        eventId,
        new Map(
          eventMetrics
            .filter((item) => item.eventId === eventId)
            .map((item) => [
              String(item.cbtmCategoryId),
              {
                categoryId: String(item.cbtmCategoryId),
                categoryName: "ABSOLUTO E (MAS)",
                valid: true,
                registeredCount: 4,
                preRegisteredCount: 0,
                totalListedCount: 4,
                officialMatchesCount: 6,
              },
            ]),
        ),
      ]),
    );
  service.countWalkoversByCategoryIds = async (_eventIds: number[], categoryIds: number[]) =>
    new Map(categoryIds.map((categoryId) => [categoryId, eventMetricsByCategoryId.get(categoryId)?.published ? 1 : 0]));

  return {
    service,
    getCategoryFindManyCalls: () => categoryFindManyCalls,
    getCachedRecord: () => cachedRecord,
  };
}

test("event summary persiste read model e reutiliza cache valido no mesmo scrape run", async () => {
  const harness = createServiceHarness();

  const first = await harness.service.getEventSummary(1);
  assert.equal(first.totalCategorias, 1);
  assert.equal(first.totalInscritos, 4);
  assert.equal(first.totalPartidasPrevistas, 6);
  assert.equal(first.totalPartidasPrevistasFonte, "estimada");
  assert.equal(first.totalPartidasPublicadas, 5);
  assert.equal(first.totalPartidasWo, 1);
  assert.equal(first.totalPartidasJogadas, 4);

  const categoryCallsAfterFirst = harness.getCategoryFindManyCalls();
  assert.ok(categoryCallsAfterFirst > 0);

  const second = await harness.service.getEventSummary(1);
  assert.deepEqual(second, first);
  assert.equal(harness.getCategoryFindManyCalls(), categoryCallsAfterFirst);
});

test("PP-016 T-I-02 event summary usa fonte observada quando publicado supera teorico", async () => {
  const harness = createServiceHarness({ publishedMatchesCount: 9 });

  const summary = await harness.service.getEventSummary(1);

  assert.equal(summary.totalPartidasPrevistas, 9);
  assert.equal(summary.totalPartidasPrevistasFonte, "observada");
});

test("PP-016 T-I-03 event summary agregado usa fonte observada quando filho foi calibrado", async () => {
  const harness = createServiceHarness({
    scopeEventIds: [1, 2],
    eventMetrics: [
      { eventId: 1, categoryId: 10, cbtmCategoryId: 111, published: 5 },
      { eventId: 2, categoryId: 20, cbtmCategoryId: 222, published: 9 },
    ],
  });

  const summary = await harness.service.getEventSummary(1);

  assert.equal(summary.totalPartidasPrevistasFonte, "observada");
});

test("PP-016 T-I-04 event summary usa cache v13 e ignora payload v12 sem fonte", async () => {
  const harness = createServiceHarness({
    cachedRecord: {
      key: "event-summary-v12|event:1",
      sourceScrapeRunId: 99,
      payload: { id: 1, totalPartidasPrevistas: 6 },
      updatedAt: new Date("2026-03-09T10:00:00.000Z"),
    },
  });

  const summary = await harness.service.getEventSummary(1);

  assert.equal(summary.totalPartidasPrevistasFonte, "estimada");
  assert.equal(harness.getCachedRecord()?.key, "event-summary-v13|event:1");
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
