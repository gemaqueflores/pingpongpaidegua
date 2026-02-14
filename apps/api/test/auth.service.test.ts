import test from "node:test";
import assert from "node:assert/strict";
import { hashSync } from "bcryptjs";
import { JwtService } from "@nestjs/jwt";
import { AuthService } from "../src/auth/auth.service";

type ResetRow = {
  id: number;
  email: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
};

function createPrismaMock() {
  const rows: ResetRow[] = [];
  let nextId = 1;
  const adminStore = {
    id: 1,
    username: process.env.ADMIN_USERNAME ?? "admin",
    passwordHash: process.env.ADMIN_PASSWORD_HASH ?? hashSync("senha-correta", 4),
  };

  return {
    rows,
    prisma: {
      passwordResetToken: {
        create: async ({ data }: { data: Omit<ResetRow, "id" | "usedAt" | "createdAt"> }) => {
          const row: ResetRow = {
            id: nextId++,
            email: data.email,
            tokenHash: data.tokenHash,
            expiresAt: data.expiresAt,
            usedAt: null,
            createdAt: new Date(),
          };
          rows.push(row);
          return row;
        },
        findFirst: async ({ where }: { where: { tokenHash: string } }) => {
          return rows.find((row) => row.tokenHash === where.tokenHash) ?? null;
        },
        update: async ({ where, data }: { where: { id: number }; data: { usedAt: Date } }) => {
          const target = rows.find((row) => row.id === where.id);
          if (!target) {
            throw new Error("row_not_found");
          }
          target.usedAt = data.usedAt;
          return target;
        },
      },
      adminCredential: {
        findUnique: async ({ where }: { where: { username: string } }) => {
          if (where.username !== adminStore.username) {
            return null;
          }
          return {
            id: adminStore.id,
            username: adminStore.username,
            passwordHash: adminStore.passwordHash,
          };
        },
        create: async ({ data }: { data: { username: string; passwordHash: string } }) => {
          adminStore.id = adminStore.id + 1;
          adminStore.username = data.username;
          adminStore.passwordHash = data.passwordHash;
          return {
            id: adminStore.id,
            username: adminStore.username,
            passwordHash: adminStore.passwordHash,
          };
        },
        update: async ({ where, data }: { where: { id: number }; data: { passwordHash: string } }) => {
          if (where.id !== adminStore.id) {
            throw new Error("admin_not_found");
          }
          adminStore.passwordHash = data.passwordHash;
          return {
            id: adminStore.id,
            username: adminStore.username,
            passwordHash: adminStore.passwordHash,
          };
        },
      },
    } as any,
  };
}

function createAuthService(input?: { nowProvider?: () => number }) {
  const jwtService = new JwtService({
    secret: "test-secret",
    signOptions: { expiresIn: "1h" },
  });
  const prismaMock = createPrismaMock();
  const authService = new AuthService(jwtService, prismaMock.prisma);
  if (input?.nowProvider) {
    authService.setNowProvider(input.nowProvider);
  }

  return {
    authService,
    rows: prismaMock.rows,
  };
}

async function withEnv(
  callback: () => Promise<void>,
  values: Record<string, string>,
): Promise<void> {
  const backup = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    backup.set(key, process.env[key]);
    process.env[key] = value;
  }
  try {
    await callback();
  } finally {
    for (const [key, value] of backup.entries()) {
      process.env[key] = value;
    }
  }
}

test("bloqueia login apos 3 tentativas invalidas", async () => {
  await withEnv(async () => {
    const { authService } = createAuthService();

    await assert.rejects(() => authService.login("admin", "x", "ip-1"), /Credenciais invalidas/);
    await assert.rejects(() => authService.login("admin", "x", "ip-1"), /Credenciais invalidas/);
    await assert.rejects(
      () => authService.login("admin", "x", "ip-1"),
      /Limite de tentativas excedido/,
    );
    await assert.rejects(
      () => authService.login("admin", "senha-correta", "ip-1"),
      /Limite de tentativas excedido/,
    );
  }, {
    ADMIN_USERNAME: "admin",
    ADMIN_PASSWORD_HASH: hashSync("senha-correta", 4),
    ADMIN_LOCKOUT_MINUTES: "10",
    ADMIN_MAX_LOGIN_ATTEMPTS: "3",
  });
});

test("sucesso de login reseta contador de falhas", async () => {
  await withEnv(async () => {
    const { authService } = createAuthService();

    await assert.rejects(() => authService.login("admin", "x", "ip-2"), /Credenciais invalidas/);
    await assert.rejects(() => authService.login("admin", "x", "ip-2"), /Credenciais invalidas/);

    const success = await authService.login("admin", "senha-correta", "ip-2");
    assert.equal(typeof success.accessToken, "string");
    assert.equal(success.role, "ADMIN");

    await assert.rejects(() => authService.login("admin", "x", "ip-2"), /Credenciais invalidas/);
    await assert.rejects(() => authService.login("admin", "x", "ip-2"), /Credenciais invalidas/);
    await assert.rejects(
      () => authService.login("admin", "x", "ip-2"),
      /Limite de tentativas excedido/,
    );
  }, {
    ADMIN_USERNAME: "admin",
    ADMIN_PASSWORD_HASH: hashSync("senha-correta", 4),
    ADMIN_LOCKOUT_MINUTES: "10",
    ADMIN_MAX_LOGIN_ATTEMPTS: "3",
  });
});

test("permite novo login apos expiracao do bloqueio", async () => {
  await withEnv(async () => {
    let now = 1_000_000;
    const { authService } = createAuthService({ nowProvider: () => now });

    await assert.rejects(() => authService.login("admin", "x", "ip-3"), /Credenciais invalidas/);
    await assert.rejects(() => authService.login("admin", "x", "ip-3"), /Credenciais invalidas/);
    await assert.rejects(
      () => authService.login("admin", "x", "ip-3"),
      /Limite de tentativas excedido/,
    );

    now += 61_000;

    const success = await authService.login("admin", "senha-correta", "ip-3");
    assert.equal(typeof success.accessToken, "string");
    assert.equal(success.role, "ADMIN");
  }, {
    ADMIN_USERNAME: "admin",
    ADMIN_PASSWORD_HASH: hashSync("senha-correta", 4),
    ADMIN_LOCKOUT_MINUTES: "1",
    ADMIN_MAX_LOGIN_ATTEMPTS: "3",
  });
});

test("forgot password cria token com expiracao e resposta generica", async () => {
  await withEnv(async () => {
    let now = 1_500_000;
    const { authService, rows } = createAuthService({ nowProvider: () => now });

    (authService as any).sendResetEmail = async () => undefined;
    const response = await authService.forgotPassword("admin");
    assert.equal(response.success, true);
    assert.match(response.message, /instrucoes de reset/i);
    assert.equal(rows.length, 1);
    assert.equal(typeof rows[0].tokenHash, "string");
    assert.ok(rows[0].tokenHash.length > 20);
    assert.ok(rows[0].expiresAt.getTime() > now);
  }, {
    ADMIN_USERNAME: "admin",
    ADMIN_PASSWORD_HASH: hashSync("senha-correta", 4),
    ADMIN_RESET_EMAIL: "gemaqueflores@gmail.com",
    ADMIN_RESET_TOKEN_TTL_MINUTES: "30",
  });
});

test("reset password invalida token e impede reuso", async () => {
  await withEnv(async () => {
    let now = 2_000_000;
    const { authService } = createAuthService({ nowProvider: () => now });
    const rawToken = "token-valido-12345678901234567890";
    const tokenHash = (authService as any).tokenHash(rawToken);

    await (authService as any).prisma.passwordResetToken.create({
      data: {
        email: "gemaqueflores@gmail.com",
        tokenHash,
        expiresAt: new Date(now + 300000),
      },
    });

    const resetResult = await authService.resetPassword(rawToken, "novaSenha@123");
    assert.equal(resetResult.success, true);

    await assert.rejects(
      () => authService.resetPassword(rawToken, "outraSenha@123"),
      /Token de reset invalido ou expirado/,
    );
  }, {
    ADMIN_USERNAME: "admin",
    ADMIN_PASSWORD_HASH: hashSync("senha-correta", 4),
  });
});

test("reset password falha com token expirado", async () => {
  await withEnv(async () => {
    let now = 3_000_000;
    const { authService } = createAuthService({ nowProvider: () => now });
    const rawToken = "token-expirado-12345678901234567890";
    const tokenHash = (authService as any).tokenHash(rawToken);

    await (authService as any).prisma.passwordResetToken.create({
      data: {
        email: "gemaqueflores@gmail.com",
        tokenHash,
        expiresAt: new Date(now - 1000),
      },
    });

    await assert.rejects(
      () => authService.resetPassword(rawToken, "novaSenha@123"),
      /Token de reset invalido ou expirado/,
    );
  }, {
    ADMIN_USERNAME: "admin",
    ADMIN_PASSWORD_HASH: hashSync("senha-correta", 4),
  });
});
