import test from "node:test";
import assert from "node:assert/strict";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { AuthController } from "../src/auth/auth.controller";
import { JwtAuthGuard } from "../src/common/jwt-auth.guard";
import { ROLES_KEY } from "../src/common/roles.decorator";
import { RolesGuard } from "../src/common/roles.guard";

test("PP-034 T-I-03: endpoint revoga as sessoes do admin autenticado", async () => {
  const calls: string[] = [];
  const service = {
    revokeSessions: async (username: string) => {
      calls.push(username);
      return { success: true as const };
    },
  };
  const controller = new AuthController(service as any);

  const result = await controller.revokeSessions({
    userId: "admin-real",
    username: "admin-real",
    role: "ADMIN",
  });

  assert.deepEqual(result, { success: true });
  assert.deepEqual(calls, ["admin-real"]);
});

test("PP-034: endpoint de revogacao exige JWT e role ADMIN", () => {
  const handler = AuthController.prototype.revokeSessions;
  const roles = Reflect.getMetadata(ROLES_KEY, handler);
  const guards = Reflect.getMetadata(GUARDS_METADATA, handler);

  assert.deepEqual(roles, ["ADMIN"]);
  assert.deepEqual(guards, [JwtAuthGuard, RolesGuard]);
});
