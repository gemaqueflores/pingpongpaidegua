import assert from "node:assert/strict";
import test from "node:test";
import { AdminEventsService } from "../src/admin/admin-events.service";

test("PP-015 T-U-04 updateEfficiencyConfig fecha vigencia anterior em transacao", async () => {
  let transactionCalls = 0;
  const previous = {
    id: 1,
    dataInicioVigencia: new Date("2026-01-01T00:00:00.000Z"),
    dataFimVigencia: null,
    pesoOuro: 130,
    pesoPrata: 80,
    pesoBronze: 50,
  };
  let closedPrevious: Date | null = null;
  let createdVersion:
    | {
        dataInicioVigencia: Date;
        dataFimVigencia: Date | null;
        pesoOuro: number;
        pesoPrata: number;
        pesoBronze: number;
      }
    | null = null;

  const tx = {
    efficiencyConfigVersion: {
      async findFirst() {
        return previous;
      },
      async update(input: { data: { dataFimVigencia: Date } }) {
        closedPrevious = input.data.dataFimVigencia;
        return { ...previous, dataFimVigencia: closedPrevious };
      },
      async create(input: { data: typeof createdVersion }) {
        createdVersion = input.data;
        return { id: 2, ...input.data };
      },
    },
  };
  const prisma = {
    async $transaction<T>(callback: (client: typeof tx) => Promise<T>) {
      transactionCalls += 1;
      return callback(tx);
    },
    efficiencyConfig: {
      async upsert() {
        return { id: 1, pesoOuro: 400, pesoPrata: 240, pesoBronze: 120 };
      },
    },
  };

  const service = new AdminEventsService(prisma as never, {} as never, {} as never);
  const result = await service.updateEfficiencyConfig({ pesoOuro: 400, pesoPrata: 240, pesoBronze: 120 });

  assert.equal(transactionCalls, 1);
  assert.ok(closedPrevious);
  assert.ok(createdVersion);
  assert.equal(createdVersion?.dataFimVigencia, null);
  assert.equal(createdVersion?.pesoOuro, 400);
  assert.equal(createdVersion?.pesoPrata, 240);
  assert.equal(createdVersion?.pesoBronze, 120);
  assert.equal(result.pesoOuro, 400);
});
