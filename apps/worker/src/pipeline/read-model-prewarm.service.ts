import { config } from "../config";
import { log } from "../logger";
import { prisma } from "../prisma";

export class ReadModelPrewarmService {
  async prewarmEvent(eventId: number): Promise<void> {
    if (!config.readModelPrewarmEnabled) {
      return;
    }

    const baseUrl = config.readModelPrewarmApiBaseUrl.replace(/\/$/, "");
    const eventUrl = `${baseUrl}/events/${eventId}`;

    try {
      await this.fetchWithTimeout(eventUrl, config.readModelPrewarmTimeoutMs);
    } catch (error) {
      log("warn", "Falha no prewarm do resumo de evento", {
        eventId,
        url: eventUrl,
        error: String(error),
      });
      return;
    }

    const athleteRows = await prisma.athlete.findMany({
      where: {
        eventId,
        createdFromWarning: false,
      },
      select: {
        id: true,
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: config.readModelPrewarmAthleteLimit,
    });

    const athleteIds = athleteRows.map((row) => row.id);
    if (athleteIds.length === 0) {
      return;
    }

    const concurrency = Math.max(1, Math.min(config.readModelPrewarmConcurrency, 5));
    let cursor = 0;
    const runBatch = async () => {
      while (cursor < athleteIds.length) {
        const index = cursor;
        cursor += 1;
        const athleteId = athleteIds[index];
        const summaryUrl = `${baseUrl}/events/${eventId}/athletes/${athleteId}/summary?orderBy=phase_hierarchy_datetime`;
        try {
          await this.fetchWithTimeout(summaryUrl, config.readModelPrewarmTimeoutMs);
        } catch (error) {
          log("warn", "Falha no prewarm do resumo de atleta", {
            eventId,
            athleteId,
            url: summaryUrl,
            error: String(error),
          });
        }
      }
    };

    await Promise.all(Array.from({ length: concurrency }, () => runBatch()));

    log("info", "Prewarm read-model concluido", {
      eventId,
      athleteSummaries: athleteIds.length,
      concurrency,
    });
  }

  private async fetchWithTimeout(url: string, timeoutMs: number): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "x-prewarm": "1",
        },
        signal: controller.signal,
      });
      if (!response.ok && response.status !== 304) {
        throw new Error(`HTTP ${response.status}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }
}
