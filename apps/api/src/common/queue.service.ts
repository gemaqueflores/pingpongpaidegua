import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly queue: Queue;

  constructor() {
    const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
    this.queue = new Queue("scrape-event", {
      connection: {
        url: redisUrl,
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
      this.logger.log(`Job reaproveitado (${jobId})`, {
        eventId: data.eventId,
        reason: data.reason,
      });
      return {
        jobId: String(existing.id),
        status: "queued",
        deduplicated: true,
      };
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
