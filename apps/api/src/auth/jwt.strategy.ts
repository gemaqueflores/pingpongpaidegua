import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { PrismaService } from "../common/prisma.service";
import { resolveJwtSecret } from "./auth-config";

export interface JwtPayload {
  sub?: unknown;
  username?: unknown;
  role?: unknown;
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
      payload.sub !== payload.username
    ) {
      throw new UnauthorizedException("Sessao administrativa invalida");
    }

    const credential = await this.prisma.adminCredential.findUnique({
      where: { username: payload.username },
      select: { username: true },
    });

    if (!credential) {
      throw new UnauthorizedException("Sessao administrativa invalida");
    }

    return {
      userId: credential.username,
      username: credential.username,
      role: "ADMIN",
    };
  }
}
