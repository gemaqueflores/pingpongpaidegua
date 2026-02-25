import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private queue: Queue;
  private readonly redisUrl: string;

  constructor() {
    this.redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
    this.queue = this.createQueue();
  }

  private createQueue(): Queue {
    return new Queue("scrape-event", {
      connection: {
        url: this.redisUrl,
      },
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 5000,
        },
        removeOnComplete: {
          age: 3600,
          count: 2000,
        },
        removeOnFail: {
          age: 86400,
          count: 5000,
        },
      },
    });
  }

  async getHealth(): Promise<{
    status: "ok" | "error";
    queueName: string;
    waiting?: number;
    active?: number;
    delayed?: number;
    failed?: number;
    completed?: number;
    error?: string;
  }> {
    try {
      await this.queue.waitUntilReady();
      const counts = await this.queue.getJobCounts("waiting", "active", "delayed", "failed", "completed");
      return {
        status: "ok",
        queueName: this.queue.name,
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        delayed: counts.delayed ?? 0,
        failed: counts.failed ?? 0,
        completed: counts.completed ?? 0,
      };
    } catch (error) {
      return {
        status: "error",
        queueName: this.queue.name,
        error: error instanceof Error ? error.message : "Erro desconhecido na fila",
      };
    }
  }

  async ensureHealthy(): Promise<boolean> {
    const probe = await this.getHealth();
    if (probe.status === "ok") {
      return true;
    }

    this.logger.error("Falha ao acessar fila. Tentando autorecuperacao da conexao Redis.", probe.error);
    try {
      await this.queue.close();
    } catch (closeError) {
      this.logger.warn(
        `Erro ao fechar conexao antiga da fila: ${closeError instanceof Error ? closeError.message : "desconhecido"}`,
      );
    }

    this.queue = this.createQueue();
    const retryProbe = await this.getHealth();
    if (retryProbe.status === "ok") {
      this.logger.log("Autorecuperacao da fila concluida com sucesso.");
      return true;
    }

    this.logger.error("Autorecuperacao da fila falhou.", retryProbe.error);
    return false;
  }

  async enqueueScrape(
    eventId: number,
    reason = "manual",
  ): Promise<{ jobId: string; status: "queued"; deduplicated?: boolean }> {
    const minuteBucket = Math.floor(Date.now() / 60000);
    const reasonToken = this.toJobIdToken(reason);
    const jobId = `event-${eventId}-${reasonToken}-${minuteBucket}`;
    return this.enqueueUnique("scrape-event", { eventId, reason }, jobId);
  }

  async enqueueScrapeNow(
    eventId: number,
    stage?: 1 | 2 | 3,
  ): Promise<{ jobId: string; status: "queued"; deduplicated?: boolean }> {
    const minuteBucket = Math.floor(Date.now() / 60000);
    const reason =
      stage === 1
        ? "scrape-now-force:stage-1"
        : stage === 2
          ? "scrape-now-force:stage-2"
          : stage === 3
            ? "scrape-now-force:stage-3"
            : "scrape-now-force";
    const reasonToken = this.toJobIdToken(reason);
    const jobId = `event-${eventId}-${reasonToken}-${minuteBucket}`;
    return this.enqueueUnique("scrape-event", { eventId, reason }, jobId);
  }

  async enqueuePostScrapeReprocess(
    eventId: number,
  ): Promise<{ jobId: string; status: "queued"; deduplicated?: boolean }> {
    const minuteBucket = Math.floor(Date.now() / 60000);
    const reason = "post-scrape-reprocess";
    const reasonToken = this.toJobIdToken(reason);
    const jobId = `event-${eventId}-${reasonToken}-${minuteBucket}`;
    return this.enqueueUnique("scrape-event", { eventId, reason }, jobId);
  }

  async enqueuePublishReadonly(
    eventId: number,
    mode: "incremental" | "full_event_rebuild" = "incremental",
  ): Promise<{ jobId: string; status: "queued"; deduplicated?: boolean }> {
    const minuteBucket = Math.floor(Date.now() / 60000);
    const reason = mode;
    const reasonToken = this.toJobIdToken(mode);
    const jobId = `publish-readonly-${eventId}-${reasonToken}-${minuteBucket}`;
    return this.enqueueUnique("publish-readonly-event", { eventId, reason }, jobId);
  }

  async enqueuePublishOpenEvents(): Promise<{ jobId: string; status: "queued"; deduplicated?: boolean }> {
    const minuteBucket = Math.floor(Date.now() / 60000);
    const jobId = `publish-open-events-${minuteBucket}`;
    return this.enqueueUnique("publish-open-events", { eventId: 0, reason: "incremental-open-events" }, jobId);
  }

  async hasPendingScrapeJobForEvent(eventId: number): Promise<boolean> {
    const jobs = await this.queue.getJobs(["waiting", "active", "delayed"], 0, 300, false);
    return jobs.some((job) => {
      const data = (job.data ?? {}) as { eventId?: unknown };
      return job.name === "scrape-event" && Number(data.eventId) === eventId;
    });
  }

  private toJobIdToken(input: string): string {
    const raw = String(input ?? "").trim().toLowerCase();
    if (!raw) {
      return "manual";
    }

    return raw
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }

  private async enqueueUnique(
    name: string,
    data: { eventId: number; reason: string },
    jobId: string,
  ): Promise<{ jobId: string; status: "queued"; deduplicated?: boolean }> {
    const existing = await this.queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === "waiting" || state === "delayed" || state === "active") {
        this.logger.log(`Job reaproveitado (${jobId})`, {
          eventId: data.eventId,
          reason: data.reason,
          state,
        });
        return {
          jobId: String(existing.id),
          status: "queued",
          deduplicated: true,
        };
      }

      await existing.remove();
      this.logger.log(`Job reaproveitado (${jobId})`, {
        eventId: data.eventId,
        reason: data.reason,
        state,
        recreated: true,
      });
    }

    const job = await this.queue.add(name, data, { jobId });
    this.logger.log(`Job enfileirado (${jobId})`, {
      eventId: data.eventId,
      reason: data.reason,
    });

    return {
      jobId: String(job.id),
      status: "queued",
      deduplicated: false,
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
