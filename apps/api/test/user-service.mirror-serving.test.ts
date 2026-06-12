import assert from "node:assert/strict";
import test from "node:test";
import { UserService } from "../src/user/user.service";

function serviceWithCache(cachedRecord: null | { key: string; payload: Record<string, unknown>; updatedAt: Date; sourceScrapeRunId: number | null }) {
  let upsertCalls = 0;
  const prismaRead = {
    readModelCache: {
      async findUnique({ where }: { where: { key: string } }) {
        return cachedRecord?.key === where.key ? cachedRecord : null;
      },
    },
  };
  const prismaWrite = {
    readModelCache: {
      async upsert(input: { where: { key: string }; update: { payload: Record<string, unknown>; sourceScrapeRunId: number | null } }) {
        upsertCalls += 1;
        cachedRecord = {
          key: input.where.key,
          payload: input.update.payload,
          sourceScrapeRunId: input.update.sourceScrapeRunId,
          updatedAt: new Date("2026-06-12T10:00:00.000Z"),
        };
      },
    },
  };

  return {
    service: new UserService(prismaRead as never, prismaWrite as never) as UserService & {
      resolveEventReadModelCache<T extends Record<string, unknown>>(input: {
        event: Record<string, unknown>;
        cacheKey: string;
        kind: string;
        eventId: number;
        latestReliableRunId: number | null;
        buildingPayload?: T;
        compute: () => Promise<T>;
      }): Promise<T>;
    },
    getUpsertCalls: () => upsertCalls,
  };
}

test("T-U-01 run ativo serve espelho stale sem compute", async () => {
  const harness = serviceWithCache({
    key: "event-summary-v12|event:1",
    payload: { eventId: 1, totalInscritos: 42, _meta: { publishedAt: "2026-06-12T09:00:00.000Z" } },
    sourceScrapeRunId: 1,
    updatedAt: new Date("2026-06-01T00:00:00.000Z"),
  });
  let computeCalls = 0;

  const payload = await harness.service.resolveEventReadModelCache({
    event: baseEvent({ scrapeLockedAt: new Date() }),
    cacheKey: "event-summary-v12|event:1",
    kind: "event-summary",
    eventId: 1,
    latestReliableRunId: 99,
    compute: async () => {
      computeCalls += 1;
      return { eventId: 1, totalInscritos: 0 };
    },
  });

  assert.equal(payload.totalInscritos, 42);
  assert.equal(computeCalls, 0);
  assert.equal(harness.getUpsertCalls(), 0);
});

test("T-U-02 run ativo sem espelho retorna building sem compute", async () => {
  const harness = serviceWithCache(null);
  let computeCalls = 0;

  const payload = await harness.service.resolveEventReadModelCache({
    event: baseEvent({ scrapeLockedAt: new Date() }),
    cacheKey: "event-athletes-v1|event:1",
    kind: "event-athletes",
    eventId: 1,
    latestReliableRunId: 99,
    buildingPayload: { eventId: 1, items: [], _meta: { building: true } },
    compute: async () => {
      computeCalls += 1;
      return { eventId: 1, items: [{ id: 1 }] };
    },
  });

  assert.deepEqual(payload.items, []);
  assert.equal(payload._meta?.building, true);
  assert.equal(computeCalls, 0);
});

test("T-U-03 lock vazado permite compute", async () => {
  const harness = serviceWithCache(null);
  let computeCalls = 0;

  const payload = await harness.service.resolveEventReadModelCache({
    event: baseEvent({ scrapeLockedAt: new Date(Date.now() - 20 * 60 * 1000) }),
    cacheKey: "event-athletes-v1|event:1",
    kind: "event-athletes",
    eventId: 1,
    latestReliableRunId: 99,
    compute: async () => {
      computeCalls += 1;
      return { eventId: 1, items: [{ id: 1 }] };
    },
  });

  assert.equal(computeCalls, 1);
  assert.equal(payload.items.length, 1);
  assert.equal(harness.getUpsertCalls(), 1);
});

test("T-U-04 cache fresco sem run preserva fluxo atual", async () => {
  const harness = serviceWithCache({
    key: "event-summary-v12|event:1",
    payload: { eventId: 1, totalInscritos: 55 },
    sourceScrapeRunId: 99,
    updatedAt: new Date(),
  });
  let computeCalls = 0;

  const payload = await harness.service.resolveEventReadModelCache({
    event: baseEvent({ scrapeLockedAt: null }),
    cacheKey: "event-summary-v12|event:1",
    kind: "event-summary",
    eventId: 1,
    latestReliableRunId: 99,
    compute: async () => {
      computeCalls += 1;
      return { eventId: 1, totalInscritos: 0 };
    },
  });

  assert.equal(payload.totalInscritos, 55);
  assert.equal(computeCalls, 0);
});

function baseEvent(overrides: Record<string, unknown>) {
  return {
    concluido: false,
    scrapeLockedAt: null,
    inicioInscricoes: new Date("2026-06-01T00:00:00.000Z"),
    fimInscricoes: new Date("2026-06-10T00:00:00.000Z"),
    inicioRealizacao: new Date("2026-06-20T00:00:00.000Z"),
    fimRealizacao: new Date("2026-06-21T00:00:00.000Z"),
    dataInicio: new Date("2026-06-20T00:00:00.000Z"),
    dataFim: new Date("2026-06-21T00:00:00.000Z"),
    ...overrides,
  };
}
