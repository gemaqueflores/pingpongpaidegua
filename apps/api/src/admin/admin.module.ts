import { Module } from "@nestjs/common";
import { AdminEventsController } from "./admin-events.controller";
import { AdminEventsService } from "./admin-events.service";
import { PrismaService } from "../common/prisma.service";
import { QueueService } from "../common/queue.service";
import { RawCaptureRetentionService } from "./raw-capture-retention.service";

@Module({
  controllers: [AdminEventsController],
  providers: [AdminEventsService, PrismaService, QueueService, RawCaptureRetentionService],
})
export class AdminModule {}

