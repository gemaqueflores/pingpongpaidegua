import test from "node:test";
import assert from "node:assert/strict";
import { UnauthorizedException } from "@nestjs/common";
import { RolesGuard } from "../src/common/roles.guard";
import { JwtStrategy } from "../src/auth/jwt.strategy";

type Credential = {
  id: number;
  username: string;
  passwordHash: string;
  tokenVersion: number;
};

function createStrategy(credential: Credential | null): JwtStrategy {
  process.env.JWT_SECRET = "jwt-strategy-test-secret-minimum-32";
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
      tokenVersion: 0,
    } as any)),
    UnauthorizedException,
  );
});

test("T-I-02: credencial existente autoriza fluxo administrativo legitimo", async () => {
  const strategy = createStrategy({
    id: 1,
    username: "admin-real",
    passwordHash: "hash-nao-utilizado-neste-teste",
    tokenVersion: 2,
  });
  const user = await strategy.validate({
    sub: "admin-real",
    username: "admin-real",
    role: "ADMIN",
    tokenVersion: 2,
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
    tokenVersion: 2,
  });

  const user = await strategy.validate({
    sub: "admin-real",
    username: "admin-real",
    role: "USER",
    tokenVersion: 2,
  } as any);

  assert.equal(user.role, "ADMIN");
  assert.equal(user.username, "admin-real");
});

test("T-I-04: rejeita payload com sub e username divergentes", async () => {
  const strategy = createStrategy({
    id: 1,
    username: "admin-real",
    passwordHash: "hash-nao-utilizado-neste-teste",
    tokenVersion: 2,
  });

  await assert.rejects(
    () => Promise.resolve(strategy.validate({
      sub: "outro-admin",
      username: "admin-real",
      role: "ADMIN",
      tokenVersion: 2,
    } as any)),
    UnauthorizedException,
  );
});

test("PP-034 T-I-01 / PP-042 T-U-04: rejeita tokenVersion desatualizado sem role", async () => {
  const strategy = createStrategy({
    id: 1,
    username: "admin-real",
    passwordHash: "hash-nao-utilizado-neste-teste",
    tokenVersion: 3,
  });

  await assert.rejects(
    () => strategy.validate({
      sub: "admin-real",
      username: "admin-real",
      tokenVersion: 2,
    }),
    UnauthorizedException,
  );
});

test("PP-034 T-I-02 / PP-042 T-U-03: aceita payload atual sem role", async () => {
  const strategy = createStrategy({
    id: 1,
    username: "admin-real",
    passwordHash: "hash-nao-utilizado-neste-teste",
    tokenVersion: 3,
  });

  const user = await strategy.validate({
    sub: "admin-real",
    username: "admin-real",
    tokenVersion: 3,
  });

  assert.equal(user.username, "admin-real");
  assert.equal(user.role, "ADMIN");
});

test("PP-034: rejeita token legado sem tokenVersion", async () => {
  const strategy = createStrategy({
    id: 1,
    username: "admin-real",
    passwordHash: "hash-nao-utilizado-neste-teste",
    tokenVersion: 0,
  });

  await assert.rejects(
    () => strategy.validate({
      sub: "admin-real",
      username: "admin-real",
      role: "ADMIN",
    } as any),
    UnauthorizedException,
  );
});
