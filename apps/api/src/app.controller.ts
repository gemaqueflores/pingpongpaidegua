import { Controller, Get } from "@nestjs/common";
import { PrismaReadService } from "./common/prisma.service";
import { QueueService } from "./common/queue.service";

@Controller()
export class AppController {
  constructor(
    private readonly prismaRead: PrismaReadService,
    private readonly queueService: QueueService,
  ) {}

  @Get()
  async health(): Promise<{
    status: "ok" | "degraded";
    service: "api";
    timestamp: string;
    uptimeSec: number;
    checks: {
      database: { status: "ok" | "error"; error?: string };
      queue: {
        status: "ok" | "error";
        queueName: string;
        waiting?: number;
        active?: number;
        delayed?: number;
        failed?: number;
        completed?: number;
        error?: string;
      };
    };
  }> {
    const databaseCheck = await this.checkDatabase();
    const queueCheck = await this.queueService.getHealth();
    const status = databaseCheck.status === "ok" && queueCheck.status === "ok" ? "ok" : "degraded";

    return {
      status,
      service: "api",
      timestamp: new Date().toISOString(),
      uptimeSec: Math.floor(process.uptime()),
      checks: {
        database: databaseCheck,
        queue: queueCheck,
      },
    };
  }

  private async checkDatabase(): Promise<{ status: "ok" | "error"; error?: string }> {
    try {
      await this.prismaRead.$queryRaw`SELECT 1`;
      return { status: "ok" };
    } catch (error) {
      return {
        status: "error",
        error: error instanceof Error ? error.message : "Erro desconhecido no banco",
      };
    }
  }
}
