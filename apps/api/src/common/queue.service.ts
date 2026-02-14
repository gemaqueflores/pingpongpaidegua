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
    const jobId = `event-${eventId}-${reason}-${minuteBucket}`;
    return this.enqueueUnique("scrape-event", { eventId, reason }, jobId);
  }

  async enqueueScrapeNow(
    eventId: number,
  ): Promise<{ jobId: string; status: "queued"; deduplicated?: boolean }> {
    const minuteBucket = Math.floor(Date.now() / 60000);
    const reason = "scrape-now-force";
    const jobId = `event-${eventId}-${reason}-${minuteBucket}`;
    return this.enqueueUnique("scrape-event", { eventId, reason }, jobId);
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
