import assert from "node:assert/strict";
import test from "node:test";
import { UserService } from "../src/user/user.service";

function createEfficiencyServiceHarness() {
  let cachedRecord:
    | {
        key: string;
        sourceScrapeRunId: number | null;
        payload: unknown;
        updatedAt: Date;
      }
    | null = null;
  let computeCalls = 0;
  let failCompute = false;

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
    computeEfficiencyRanking(input: { eventIds?: number[] }): Promise<{
      weights: { pesoOuro: number; pesoPrata: number; pesoBronze: number };
      ranking: Array<{ clubId: number; clubName: string; ouro: number; prata: number; bronze: number }>;
    }>;
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
  service.getLatestReliableScrapeRunIdForScope = async () => 77;
  service.computeEfficiencyRanking = async () => {
    computeCalls += 1;
    if (failCompute) {
      throw new Error("forced compute failure");
    }
    return {
      weights: { pesoOuro: 130, pesoPrata: 80, pesoBronze: 50 },
      ranking: [
        {
          clubId: 1,
          clubName: "PARA CLUBE - PA",
          ouro: 2,
          prata: 1,
          bronze: 0,
        },
      ],
    };
  };

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
    setFailCompute(value: boolean) {
      failCompute = value;
    },
    getComputeCalls() {
      return computeCalls;
    },
  };
}

test("event efficiency persiste read model e reutiliza cache valido no mesmo scrape run", async () => {
  const harness = createEfficiencyServiceHarness();

  const first = await harness.service.listEventEfficiency(1);
  assert.equal(first.eventId, 1);
  assert.equal(first.eventWeight, 3);
  assert.equal(first.ranking.length, 1);
  assert.equal(first.weights.pesoOuro, 130);
  assert.equal(harness.getComputeCalls(), 1);

  const second = await harness.service.listEventEfficiency(1);
  assert.deepEqual(second, first);
  assert.equal(harness.getComputeCalls(), 1);
});

test("event efficiency usa cache stale quando recomputacao falha", async () => {
  const harness = createEfficiencyServiceHarness();
  harness.setCachedRecord({
    key: "event-efficiency-v4|event:1",
    sourceScrapeRunId: 77,
    payload: {
      eventId: 1,
      weights: { pesoOuro: 130, pesoPrata: 80, pesoBronze: 50 },
      ranking: [{ clubId: 9, clubName: "CACHE CLUBE", ouro: 1, prata: 0, bronze: 0 }],
    },
    updatedAt: new Date("2000-01-01T00:00:00.000Z"),
  });
  harness.setFailCompute(true);

  const response = await harness.service.listEventEfficiency(1);
  assert.equal(response.eventId, 1);
  assert.equal(response.ranking[0]?.clubName, "CACHE CLUBE");
  assert.deepEqual(response._meta, {
    isStale: true,
    staleReason: "compute_failed",
  });
  assert.equal(harness.getComputeCalls(), 1);
});
