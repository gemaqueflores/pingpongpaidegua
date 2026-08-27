import assert from "node:assert/strict";
import test from "node:test";
import type { ScrapeStatus } from "@prisma/client";
import { ValidationPipe } from "@nestjs/common";
import { AdminEventsController } from "../src/admin/admin-events.controller";
import { RawCaptureCleanupDto } from "../src/admin/dto/raw-capture-cleanup.dto";
import type { PrismaService } from "../src/common/prisma.service";
import { RawCaptureRetentionService } from "../src/admin/raw-capture-retention.service";

type TestRun = {
  id: number;
  eventId: number;
  startedAt: Date;
  status: ScrapeStatus;
  rawCaptures: number;
};

function createService(runs: TestRun[]) {
  const deletedRunIds: number[][] = [];
  const eventIds = [...new Set(runs.map((run) => run.eventId))];
  const prisma = {
    event: {
      findMany: async ({ where }: { where?: { id: number } }) =>
        eventIds
          .filter((eventId) => where?.id === undefined || where.id === eventId)
          .map((id) => ({ id })),
    },
    scrapeRun: {
      findMany: async ({ where }: { where: { eventId: number } }) =>
        runs
          .filter((run) => run.eventId === where.eventId)
          .sort((left, right) => right.startedAt.getTime() - left.startedAt.getTime())
          .map(({ id, startedAt, status }) => ({ id, startedAt, status })),
    },
    rawCapture: {
      count: async ({
        where,
      }: {
        where: { eventId: number; scrapeRunId?: { in: number[] } | null };
      }) => {
        if (where.scrapeRunId === null || !where.scrapeRunId) {
          return 0;
        }
        return runs
          .filter(
            (run) =>
              run.eventId === where.eventId &&
              where.scrapeRunId?.in.includes(run.id),
          )
          .reduce((total, run) => total + run.rawCaptures, 0);
      },
      deleteMany: async ({
        where,
      }: {
        where: { eventId: number; scrapeRunId?: { in: number[] } | null };
      }) => {
        const ids = where.scrapeRunId && "in" in where.scrapeRunId ? where.scrapeRunId.in : [];
        deletedRunIds.push(ids);
        return {
          count: runs
            .filter(
              (run) => run.eventId === where.eventId && ids.includes(run.id),
            )
            .reduce((total, run) => total + run.rawCaptures, 0),
        };
      },
    },
  };

  return {
    service: new RawCaptureRetentionService(prisma as unknown as PrismaService),
    deletedRunIds,
  };
}

function oldPartialRun(id: number, eventId: number, rawCaptures = 3): TestRun {
  return {
    id,
    eventId,
    startedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    status: "PARTIAL",
    rawCaptures,
  };
}

test("PP-040 T-U-01: override aplica prazo apenas na chamada sem alterar a env", async () => {
  const previous = process.env.RAW_CAPTURE_RETENTION_DAYS_ERROR;
  process.env.RAW_CAPTURE_RETENTION_DAYS_ERROR = "0";
  try {
    const { service } = createService([oldPartialRun(101, 26)]);

    const result = await service.cleanup({
      eventId: 26,
      errorDaysOverride: 7,
    });

    assert.equal(result.summary.rawCapturesPrunable, 3);
    assert.equal(result.retentionPolicy.errorDays, 7);
    assert.equal(process.env.RAW_CAPTURE_RETENTION_DAYS_ERROR, "0");
  } finally {
    if (previous === undefined) {
      delete process.env.RAW_CAPTURE_RETENTION_DAYS_ERROR;
    } else {
      process.env.RAW_CAPTURE_RETENTION_DAYS_ERROR = previous;
    }
  }
});

test("PP-040 T-U-02: sem override preserva o comportamento configurado na env", async () => {
  const previous = process.env.RAW_CAPTURE_RETENTION_DAYS_ERROR;
  process.env.RAW_CAPTURE_RETENTION_DAYS_ERROR = "0";
  try {
    const { service } = createService([oldPartialRun(102, 26)]);

    const result = await service.cleanup({ eventId: 26 });

    assert.equal(result.summary.rawCapturesPrunable, 0);
    assert.equal(result.retentionPolicy.errorDays, 0);
  } finally {
    if (previous === undefined) {
      delete process.env.RAW_CAPTURE_RETENTION_DAYS_ERROR;
    } else {
      process.env.RAW_CAPTURE_RETENTION_DAYS_ERROR = previous;
    }
  }
});

test("PP-040 T-U-03: override de um evento nao vaza para a chamada seguinte", async () => {
  const previous = process.env.RAW_CAPTURE_RETENTION_DAYS_ERROR;
  process.env.RAW_CAPTURE_RETENTION_DAYS_ERROR = "0";
  try {
    const { service } = createService([
      oldPartialRun(103, 26, 2),
      oldPartialRun(104, 29, 5),
    ]);

    const eventA = await service.cleanup({ eventId: 26, errorDaysOverride: 7 });
    const eventB = await service.cleanup({ eventId: 29 });

    assert.equal(eventA.summary.rawCapturesPrunable, 2);
    assert.equal(eventB.summary.rawCapturesPrunable, 0);
    assert.equal(eventB.retentionPolicy.errorDays, 0);
  } finally {
    if (previous === undefined) {
      delete process.env.RAW_CAPTURE_RETENTION_DAYS_ERROR;
    } else {
      process.env.RAW_CAPTURE_RETENTION_DAYS_ERROR = previous;
    }
  }
});

test("PP-040 T-U-04: dry-run com override contabiliza sem deletar", async () => {
  const { service, deletedRunIds } = createService([oldPartialRun(105, 26, 4)]);

  const result = await service.cleanup({
    eventId: 26,
    dryRun: true,
    errorDaysOverride: 7,
  });

  assert.equal(result.summary.rawCapturesPrunable, 4);
  assert.equal(result.summary.rawCapturesDeleted, 0);
  assert.deepEqual(deletedRunIds, []);
});

test("PP-040 T-U-05: rota aceita override inteiro nao negativo e rejeita invalidos antes do servico", async () => {
  const calls: unknown[] = [];
  const service = {
    cleanupRawCaptures: async (input: unknown) => {
      calls.push(input);
      return input;
    },
  };
  const controller = new AdminEventsController(service as never);
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  const dispatch = async (body: unknown) => {
    const dto = await pipe.transform(body, {
      type: "body",
      metatype: RawCaptureCleanupDto,
    });
    return controller.cleanupRawCapturesByEvent(26, dto);
  };

  await dispatch({ dryRun: true, errorDaysOverride: 7 });
  assert.deepEqual(calls, [
    { eventId: 26, dryRun: true, errorDaysOverride: 7 },
  ]);

  await assert.rejects(() => dispatch({ errorDaysOverride: -1 }));
  await assert.rejects(() => dispatch({ errorDaysOverride: "invalido" }));
  assert.equal(calls.length, 1);
});
