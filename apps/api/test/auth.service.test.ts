import test from "node:test";
import assert from "node:assert/strict";
import { hashSync } from "bcryptjs";
import { JwtService } from "@nestjs/jwt";
import { AuthService } from "../src/auth/auth.service";
import { JwtStrategy } from "../src/auth/jwt.strategy";

type AdminRow = {
  id: number;
  username: string;
  passwordHash: string;
  tokenVersion: number;
};

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
  const adminStore: AdminRow[] = [
    {
      id: 1,
      username: process.env.ADMIN_USERNAME ?? "admin",
      passwordHash: process.env.ADMIN_PASSWORD_HASH ?? hashSync("senha-correta", 4),
      tokenVersion: 0,
    },
  ];

  return {
    rows,
    adminStore,
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
          const row = adminStore.find((item) => item.username === where.username);
          return row
            ? {
                id: row.id,
                username: row.username,
                passwordHash: row.passwordHash,
                tokenVersion: row.tokenVersion,
              }
            : null;
        },
        create: async ({ data }: { data: { username: string; passwordHash: string } }) => {
          const row = {
            id: Math.max(...adminStore.map((item) => item.id)) + 1,
            username: data.username,
            passwordHash: data.passwordHash,
            tokenVersion: 0,
          };
          adminStore.push(row);
          return {
            id: row.id,
            username: row.username,
            passwordHash: row.passwordHash,
            tokenVersion: row.tokenVersion,
          };
        },
        update: async ({
          where,
          data,
        }: {
          where: { id?: number; username?: string };
          data: {
            passwordHash?: string;
            tokenVersion?: { increment: number };
          };
        }) => {
          const target = adminStore.find(
            (item) =>
              (where.id !== undefined && item.id === where.id) ||
              (where.username !== undefined && item.username === where.username),
          );
          if (!target) {
            throw new Error("admin_not_found");
          }
          if (data.passwordHash !== undefined) {
            target.passwordHash = data.passwordHash;
          }
          if (data.tokenVersion) {
            target.tokenVersion += data.tokenVersion.increment;
          }
          return {
            id: target.id,
            username: target.username,
            passwordHash: target.passwordHash,
            tokenVersion: target.tokenVersion,
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
    adminStore: prismaMock.adminStore,
    prisma: prismaMock.prisma,
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

test("PP-042 T-U-02: login preserva role ADMIN na resposta e reseta falhas", async () => {
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

test("permite login com credencial administrativa legada persistida no banco", async () => {
  await withEnv(async () => {
    const jwtService = new JwtService({
      secret: "test-secret",
      signOptions: { expiresIn: "1h" },
    });
    const prismaMock = createPrismaMock();
    const legacyHash = hashSync("senha-legada", 4);
    prismaMock.prisma.adminCredential.findUnique = async ({ where }: { where: { username: string } }) => {
      if (where.username === "mush1n-d0sh4") {
        return {
          id: 99,
          username: "mush1n-d0sh4",
          passwordHash: legacyHash,
          tokenVersion: 3,
        };
      }
      if (where.username === "admin-local") {
        return {
          id: 1,
          username: "admin-local",
          passwordHash: process.env.ADMIN_PASSWORD_HASH!,
          tokenVersion: 0,
        };
      }
      return null;
    };

    const authService = new AuthService(jwtService, prismaMock.prisma);
    const success = await authService.login("mush1n-d0sh4", "senha-legada", "ip-legacy");
    assert.equal(typeof success.accessToken, "string");
    assert.equal(success.role, "ADMIN");
  }, {
    ADMIN_USERNAME: "admin-local",
    ADMIN_PASSWORD_HASH: hashSync("senha-correta", 4),
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

test("PP-042 T-U-01: login assina payload sem role", async () => {
  await withEnv(async () => {
    let signedPayload: Record<string, unknown> | undefined;
    const jwtService = {
      signAsync: async (payload: Record<string, unknown>) => {
        signedPayload = payload;
        return "token-pp-042";
      },
    } as JwtService;
    const prismaMock = createPrismaMock();
    const authService = new AuthService(jwtService, prismaMock.prisma);

    await authService.login("admin", "senha-correta", "ip-pp-042");

    assert.deepEqual(signedPayload, {
      sub: "admin",
      username: "admin",
      tokenVersion: 0,
    });
  }, {
    ADMIN_USERNAME: "admin",
    ADMIN_PASSWORD_HASH: hashSync("senha-correta", 4),
  });
});

test("T-U-01: payload de login inclui tokenVersion atual", async () => {
  await withEnv(async () => {
    const { authService, adminStore } = createAuthService();
    adminStore[0].tokenVersion = 2;

    const result = await authService.login("admin", "senha-correta", "ip-version");
    const payload = await (authService as any).jwtService.verifyAsync(result.accessToken);

    assert.equal(payload.tokenVersion, 2);
  }, {
    ADMIN_USERNAME: "admin",
    ADMIN_PASSWORD_HASH: hashSync("senha-correta", 4),
  });
});

test("T-U-02: reset password incrementa tokenVersion na mesma atualizacao", async () => {
  await withEnv(async () => {
    const now = 4_000_000;
    const { authService, adminStore } = createAuthService({ nowProvider: () => now });
    const rawToken = "token-versionado-12345678901234567890";
    const tokenHash = (authService as any).tokenHash(rawToken);

    await (authService as any).prisma.passwordResetToken.create({
      data: {
        email: "gemaqueflores@gmail.com",
        tokenHash,
        expiresAt: new Date(now + 300000),
      },
    });

    await authService.resetPassword(rawToken, "novaSenha@123");

    assert.equal(adminStore[0].tokenVersion, 1);
  }, {
    ADMIN_USERNAME: "admin",
    ADMIN_PASSWORD_HASH: hashSync("senha-correta", 4),
  });
});

test("T-I-03/T-I-04: revogacao incrementa somente o proprio admin", async () => {
  await withEnv(async () => {
    const { authService, adminStore } = createAuthService();
    adminStore.push({
      id: 2,
      username: "segundo-admin",
      passwordHash: hashSync("outra-senha", 4),
      tokenVersion: 7,
    });

    const result = await authService.revokeSessions("admin");

    assert.deepEqual(result, { success: true });
    assert.equal(adminStore[0].tokenVersion, 1);
    assert.equal(adminStore[1].tokenVersion, 7);
  }, {
    ADMIN_USERNAME: "admin",
    ADMIN_PASSWORD_HASH: hashSync("senha-correta", 4),
  });
});

test("T-I-03: o token usado para revogar deixa de ser valido", async () => {
  await withEnv(async () => {
    const { authService, prisma } = createAuthService();
    const strategy = new JwtStrategy(prisma);
    const login = await authService.login("admin", "senha-correta", "ip-self-revoke");
    const payload = await (authService as any).jwtService.verifyAsync(login.accessToken);

    await strategy.validate(payload);
    await authService.revokeSessions("admin");

    await assert.rejects(() => strategy.validate(payload), /Sessao administrativa invalida/);
  }, {
    ADMIN_USERNAME: "admin",
    ADMIN_PASSWORD_HASH: hashSync("senha-correta", 4),
    JWT_SECRET: "jwt-strategy-pp034-test-secret-32c",
  });
});
