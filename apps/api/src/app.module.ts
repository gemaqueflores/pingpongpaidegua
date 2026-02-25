import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuthModule } from "./auth/auth.module";
import { AdminModule } from "./admin/admin.module";
import { UserModule } from "./user/user.module";
import { PrismaReadService, PrismaService } from "./common/prisma.service";
import { QueueService } from "./common/queue.service";
import { AppController } from "./app.controller";
import { HealthMonitorService } from "./common/health-monitor.service";

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), AuthModule, AdminModule, UserModule],
  controllers: [AppController],
  providers: [PrismaService, PrismaReadService, QueueService, HealthMonitorService],
  exports: [PrismaService, PrismaReadService, QueueService],
})
export class AppModule {}
