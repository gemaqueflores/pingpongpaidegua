import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { PrismaService } from "../common/prisma.service";
import { resolveJwtSecret } from "./auth-config";

export interface JwtPayload {
  sub?: unknown;
  username?: unknown;
  tokenVersion?: unknown;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: resolveJwtSecret(),
    });
  }

  async validate(
    payload: JwtPayload,
  ): Promise<{ userId: string; username: string; role: "ADMIN" }> {
    if (
      typeof payload.sub !== "string" ||
      typeof payload.username !== "string" ||
      payload.sub.length === 0 ||
      payload.sub !== payload.username ||
      typeof payload.tokenVersion !== "number" ||
      !Number.isInteger(payload.tokenVersion) ||
      payload.tokenVersion < 0
    ) {
      throw new UnauthorizedException("Sessao administrativa invalida");
    }

    const credential = await this.prisma.adminCredential.findUnique({
      where: { username: payload.username },
      select: { username: true, tokenVersion: true },
    });

    if (!credential || credential.tokenVersion !== payload.tokenVersion) {
      throw new UnauthorizedException("Sessao administrativa invalida");
    }

    // Design single-admin: role deriva da credencial administrativa no banco, nao do payload JWT.
    return {
      userId: credential.username,
      username: credential.username,
      role: "ADMIN",
    };
  }
}
