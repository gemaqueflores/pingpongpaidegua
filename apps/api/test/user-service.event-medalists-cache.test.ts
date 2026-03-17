import assert from "node:assert/strict";
import test from "node:test";
import { UserService } from "../src/user/user.service";

function createMedalistsServiceHarness() {
  let cachedRecord:
    | {
        key: string;
        sourceScrapeRunId: number | null;
        payload: unknown;
        updatedAt: Date;
      }
    | null = null;
  let categoryFindManyCalls = 0;
  let failCategoryLookup = false;

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
        if (failCategoryLookup) {
          throw new Error("forced category lookup failure");
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
    resolveEventScope(eventId: number): Promise<{ canonicalEventId: number; allEventIds: number[] }>;
    ensureEvent(eventId: number): Promise<Record<string, unknown>>;
    getLatestReliableScrapeRunIdForScope(eventIds: number[]): Promise<number>;
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
  service.getLatestReliableScrapeRunIdForScope = async () => 55;

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
    setFailCategoryLookup(value: boolean) {
      failCategoryLookup = value;
    },
    getCategoryFindManyCalls() {
      return categoryFindManyCalls;
    },
  };
}

test("event medalists persiste read model e reutiliza cache valido no mesmo scrape run", async () => {
  const harness = createMedalistsServiceHarness();

  const first = await harness.service.listEventCategoryMedalists(1);
  assert.equal(first.eventId, 1);
  assert.deepEqual(first.categories, []);
  assert.equal(harness.getCategoryFindManyCalls(), 1);

  const second = await harness.service.listEventCategoryMedalists(1);
  assert.deepEqual(second, first);
  assert.equal(harness.getCategoryFindManyCalls(), 1);
});

test("event medalists usa cache stale quando recomputacao falha", async () => {
  const harness = createMedalistsServiceHarness();
  harness.setCachedRecord({
    key: "event-medalists-v2|event:1",
    sourceScrapeRunId: 55,
    payload: {
      eventId: 1,
      categories: [
        {
          categoryId: 10,
          categoryName: "RHM",
          athleteCount: 6,
          officialRegisteredCount: 6,
          officialPreRegisteredCount: 0,
          officialTotalListedCount: 6,
          expectedMedalists: 4,
          publishedMatchesCount: 9,
          calculatedMatchesCount: 9,
          walkoverMatchesCount: 2,
          playedMatchesCount: 7,
          medalists: [],
          diagnostics: {
            status: "classificacao_pendente_ou_indefinida",
            message: "Confrontos publicados, mas a classificacao final ainda nao pode ser determinada.",
          },
        },
      ],
    },
    updatedAt: new Date("2000-01-01T00:00:00.000Z"),
  });
  harness.setFailCategoryLookup(true);

  const response = await harness.service.listEventCategoryMedalists(1);
  assert.equal(response.eventId, 1);
  assert.equal(response.categories[0]?.categoryName, "RHM");
  assert.deepEqual(response._meta, {
    isStale: true,
    staleReason: "compute_failed",
  });
  assert.equal(harness.getCategoryFindManyCalls(), 1);
});
