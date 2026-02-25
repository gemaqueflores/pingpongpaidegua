import { Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";

export interface JwtPayload {
  sub: string;
  username: string;
  role: "ADMIN";
}

function resolveJwtSecret(): string {
  const configured = process.env.JWT_SECRET?.trim();
  if (configured) {
    return configured;
  }
  if ((process.env.NODE_ENV ?? "development") === "production") {
    throw new Error("JWT_SECRET obrigatorio em producao.");
  }
  return "changeme";
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: resolveJwtSecret(),
    });
  }

  validate(payload: JwtPayload): { userId: string; username: string; role: "ADMIN" } {
    return {
      userId: payload.sub,
      username: payload.username,
      role: payload.role,
    };
  }
}

