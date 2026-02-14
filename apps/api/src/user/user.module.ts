import { Module } from "@nestjs/common";
import { UserController } from "./user.controller";
import { UserService } from "./user.service";
import { PrismaReadService } from "../common/prisma.service";

@Module({
  controllers: [UserController],
  providers: [UserService, PrismaReadService],
})
export class UserModule {}

