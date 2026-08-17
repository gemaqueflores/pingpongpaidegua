import test from "node:test";
import assert from "node:assert/strict";
import { UnauthorizedException } from "@nestjs/common";
import { RolesGuard } from "../src/common/roles.guard";
import { JwtStrategy } from "../src/auth/jwt.strategy";

type Credential = {
  id: number;
  username: string;
  passwordHash: string;
};

function createStrategy(credential: Credential | null): JwtStrategy {
  process.env.JWT_SECRET = "jwt-strategy-test-secret";
  const prisma = {
    adminCredential: {
      findUnique: async ({ where }: { where: { username: string } }) =>
        credential?.username === where.username ? credential : null,
    },
  };
  return new JwtStrategy(prisma as any);
}

function createAdminContext(user: unknown): any {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  };
}

test("T-I-01: rejeita token quando AdminCredential nao existe", async () => {
  const strategy = createStrategy(null);

  await assert.rejects(
    () => Promise.resolve(strategy.validate({
      sub: "admin-removido",
      username: "admin-removido",
      role: "ADMIN",
    } as any)),
    UnauthorizedException,
  );
});

test("T-I-02: credencial existente autoriza fluxo administrativo legitimo", async () => {
  const strategy = createStrategy({
    id: 1,
    username: "admin-real",
    passwordHash: "hash-nao-utilizado-neste-teste",
  });
  const user = await strategy.validate({
    sub: "admin-real",
    username: "admin-real",
    role: "ADMIN",
  } as any);
  const guard = new RolesGuard({
    getAllAndOverride: () => ["ADMIN"],
  } as any);

  assert.equal(guard.canActivate(createAdminContext(user)), true);
});

test("T-I-03: role da sessao vem do banco e ignora role do payload", async () => {
  const strategy = createStrategy({
    id: 1,
    username: "admin-real",
    passwordHash: "hash-nao-utilizado-neste-teste",
  });

  const user = await strategy.validate({
    sub: "admin-real",
    username: "admin-real",
    role: "USER",
  } as any);

  assert.equal(user.role, "ADMIN");
  assert.equal(user.username, "admin-real");
});

test("T-I-04: rejeita payload com sub e username divergentes", async () => {
  const strategy = createStrategy({
    id: 1,
    username: "admin-real",
    passwordHash: "hash-nao-utilizado-neste-teste",
  });

  await assert.rejects(
    () => Promise.resolve(strategy.validate({
      sub: "outro-admin",
      username: "admin-real",
      role: "ADMIN",
    } as any)),
    UnauthorizedException,
  );
});
