import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { ConfigModule } from "@nestjs/config";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtStrategy } from "./jwt.strategy";
import { PrismaService } from "../common/prisma.service";
import { resolveJwtSecret } from "./auth-config";

@Module({
  imports: [
    ConfigModule,
    PassportModule,
    JwtModule.register({
      secret: resolveJwtSecret(),
      signOptions: {
        expiresIn: (process.env.JWT_EXPIRES_IN ?? "8h") as any,
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, PrismaService],
  exports: [AuthService],
})
export class AuthModule {}


