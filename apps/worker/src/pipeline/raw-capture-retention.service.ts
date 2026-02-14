import { ScrapeStatus } from "@prisma/client";
import { config } from "../config";
import { prisma } from "../prisma";

type CleanupInput = {
  eventId?: number | null;
  dryRun?: boolean;
};

type EventCleanupResult = {
  eventId: number;
  runsTotal: number;
  runsRetained: number;
  runsPruned: number;
  rawCapturesDeleted: number;
  rawCapturesPrunable: number;
};

export function toCutoff(days: number): Date | null {
  if (!Number.isFinite(days) || days <= 0) {
    return null;
  }
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export function shouldRetainRun(input: {
  runIndex: number;
  status: ScrapeStatus;
  startedAt: Date;
  successCutoff: Date | null;
  errorCutoff: Date | null;
  maxRunsPerEvent: number;
}): boolean {
  if (input.status !== "SUCCESS") {
    if (!input.errorCutoff) {
      return true;
    }
    return input.startedAt >= input.errorCutoff;
  }

  if (input.runIndex < input.maxRunsPerEvent) {
    return true;
  }
  if (!input.successCutoff) {
    return true;
  }
  return input.startedAt >= input.successCutoff;
}

export class RawCaptureRetentionService {
  async cleanup(input: CleanupInput = {}): Promise<{
    dryRun: boolean;
    summary: {
      eventsProcessed: number;
      runsPruned: number;
      rawCapturesDeleted: number;
      rawCapturesPrunable: number;
    };
    events: EventCleanupResult[];
  }> {
    const dryRun = input.dryRun === true;
    const successCutoff = toCutoff(config.rawCaptureRetentionDaysSuccess);
    const errorCutoff = toCutoff(config.rawCaptureRetentionDaysError);
    const maxRunsPerEvent = Math.max(1, Math.floor(config.rawCaptureMaxRunsPerEvent));

    const events = await prisma.event.findMany({
      where: input.eventId ? { id: input.eventId } : undefined,
      select: { id: true },
      orderBy: { id: "asc" },
    });

    const results: EventCleanupResult[] = [];
    for (const event of events) {
      const runs = await prisma.scrapeRun.findMany({
        where: { eventId: event.id },
        select: {
          id: true,
          startedAt: true,
          status: true,
        },
        orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      });

      const retainedRunIds = new Set<number>();
      for (let index = 0; index < runs.length; index += 1) {
        const run = runs[index];
        if (
          shouldRetainRun({
            runIndex: index,
            status: run.status,
            startedAt: run.startedAt,
            successCutoff,
            errorCutoff,
            maxRunsPerEvent,
          })
        ) {
          retainedRunIds.add(run.id);
        }
      }

      const prunedRunIds = runs
        .map((run) => run.id)
        .filter((runId) => !retainedRunIds.has(runId));

      const rawCapturesFromPrunedRuns = await prisma.rawCapture.count({
        where: {
          eventId: event.id,
          scrapeRunId: { in: prunedRunIds.length > 0 ? prunedRunIds : [-1] },
        },
      });

      const nullRunWhere =
        successCutoff !== null
          ? {
              eventId: event.id,
              scrapeRunId: null,
              capturedAt: { lt: successCutoff },
            }
          : null;

      const rawCapturesWithoutRun = nullRunWhere
        ? await prisma.rawCapture.count({
            where: nullRunWhere,
          })
        : 0;

      const rawCapturesPrunable = rawCapturesFromPrunedRuns + rawCapturesWithoutRun;
      let rawCapturesDeleted = 0;

      if (!dryRun && rawCapturesPrunable > 0) {
        if (prunedRunIds.length > 0) {
          const deleted = await prisma.rawCapture.deleteMany({
            where: {
              eventId: event.id,
              scrapeRunId: { in: prunedRunIds },
            },
          });
          rawCapturesDeleted += deleted.count;
        }
        if (nullRunWhere) {
          const deletedNullRuns = await prisma.rawCapture.deleteMany({
            where: nullRunWhere,
          });
          rawCapturesDeleted += deletedNullRuns.count;
        }
      }

      results.push({
        eventId: event.id,
        runsTotal: runs.length,
        runsRetained: retainedRunIds.size,
        runsPruned: prunedRunIds.length,
        rawCapturesDeleted,
        rawCapturesPrunable,
      });
    }

    return {
      dryRun,
      summary: {
        eventsProcessed: results.length,
        runsPruned: results.reduce((acc, item) => acc + item.runsPruned, 0),
        rawCapturesDeleted: results.reduce((acc, item) => acc + item.rawCapturesDeleted, 0),
        rawCapturesPrunable: results.reduce((acc, item) => acc + item.rawCapturesPrunable, 0),
      },
      events: results,
    };
  }
}
