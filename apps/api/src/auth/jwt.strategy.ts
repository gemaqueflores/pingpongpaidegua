import { Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { resolveJwtSecret } from "./auth-config";

export interface JwtPayload {
  sub: string;
  username: string;
  role: "ADMIN";
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
