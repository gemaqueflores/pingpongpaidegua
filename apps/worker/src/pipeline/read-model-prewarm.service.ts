import { config } from "../config";
import { log } from "../logger";
import { prisma } from "../prisma";

export class ReadModelPrewarmService {
  async prewarmEvent(eventId: number, publishMode: "compare" | "replace" = "compare"): Promise<void> {
    if (!config.readModelPrewarmEnabled) {
      return;
    }

    const baseUrl = config.readModelPrewarmApiBaseUrl.replace(/\/$/, "");
    const eventUrl = `${baseUrl}/events/${eventId}`;
    const athletesUrl = `${baseUrl}/events/${eventId}/athletes?pageSize=2000`;
    const clubsUrl = `${baseUrl}/events/${eventId}/clubs?pageSize=2000`;
    const categoriesUrl = `${baseUrl}/events/${eventId}/categories`;
    const scheduleUrl = `${baseUrl}/events/${eventId}/schedule`;
    const efficiencyUrl = `${baseUrl}/events/${eventId}/efficiency`;
    const medalistsUrl = `${baseUrl}/events/${eventId}/medalists`;

    try {
      await this.fetchWithTimeout(eventUrl, config.readModelPrewarmTimeoutMs, publishMode);
    } catch (error) {
      log("warn", "Falha no prewarm do resumo de evento", {
        eventId,
        url: eventUrl,
        error: String(error),
      });
      return;
    }
    try {
      await this.fetchWithTimeout(efficiencyUrl, config.readModelPrewarmTimeoutMs, publishMode);
    } catch (error) {
      log("warn", "Falha no prewarm da eficiencia do evento", {
        eventId,
        url: efficiencyUrl,
        error: String(error),
      });
    }
    try {
      await this.fetchWithTimeout(medalistsUrl, config.readModelPrewarmTimeoutMs, publishMode);
    } catch (error) {
      log("warn", "Falha no prewarm dos medalhistas do evento", {
        eventId,
        url: medalistsUrl,
        error: String(error),
      });
    }
    for (const item of [
      ["atletas", athletesUrl],
      ["clubes", clubsUrl],
      ["categorias", categoriesUrl],
      ["agenda", scheduleUrl],
    ] as const) {
      try {
        await this.fetchWithTimeout(item[1], config.readModelPrewarmTimeoutMs, publishMode);
      } catch (error) {
        log("warn", `Falha no prewarm de ${item[0]} do evento`, {
          eventId,
          url: item[1],
          error: String(error),
        });
      }
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
          await this.fetchWithTimeout(summaryUrl, config.readModelPrewarmTimeoutMs, publishMode);
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
      eventSummary: true,
      eventEfficiency: true,
      eventMedalists: true,
      eventAthletes: true,
      eventClubs: true,
      eventCategories: true,
      eventSchedule: true,
      athleteSummaries: athleteIds.length,
      publishMode,
      concurrency,
    });
  }

  private async fetchWithTimeout(url: string, timeoutMs: number, publishMode: "compare" | "replace"): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = {
        "x-prewarm": "1",
      };
      if (config.readModelPrewarmToken) {
        headers["x-internal-prewarm-token"] = config.readModelPrewarmToken;
        headers["x-read-model-publish-mode"] = publishMode;
      }
      const response = await fetch(url, {
        method: "GET",
        headers,
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
