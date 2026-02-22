import { Module } from "@nestjs/common";
import { UserController } from "./user.controller";
import { UserService } from "./user.service";
import { PrismaReadService, PrismaService } from "../common/prisma.service";

@Module({
  controllers: [UserController],
  providers: [UserService, PrismaReadService, PrismaService],
})
export class UserModule {}
