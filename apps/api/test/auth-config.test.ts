import test from "node:test";
import assert from "node:assert/strict";
import { hashSync } from "bcryptjs";
import {
  resolveBootstrapAdminPasswordHash,
  resolveJwtSecret,
} from "../src/auth/auth-config";

const ENV_KEYS = [
  "NODE_ENV",
  "JWT_SECRET",
  "ADMIN_PASSWORD_HASH",
  "ALLOW_INSECURE_DEV_AUTH_DEFAULTS",
] as const;

async function withAuthEnv(
  values: Partial<Record<(typeof ENV_KEYS)[number], string>>,
  callback: () => Promise<void> | void,
): Promise<void> {
  const backup = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

  for (const key of ENV_KEYS) {
    const value = values[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    await callback();
  } finally {
    for (const [key, value] of backup) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("T-U-01: rejeita JWT default sem flag mesmo com NODE_ENV ausente", async () => {
  await withAuthEnv({}, () => {
    assert.throws(() => resolveJwtSecret(), /ALLOW_INSECURE_DEV_AUTH_DEFAULTS/);
  });
});

test("T-U-02: flag explicita permite defaults apenas no desenvolvimento", async () => {
  await withAuthEnv({ ALLOW_INSECURE_DEV_AUTH_DEFAULTS: "true" }, () => {
    assert.equal(resolveJwtSecret(), "local-dev-jwt-secret-change-me");
    assert.match(resolveBootstrapAdminPasswordHash(), /^\$2/);
  });
});

test("T-U-03: NODE_ENV development sozinho nao autoriza JWT default", async () => {
  await withAuthEnv({ NODE_ENV: "development" }, () => {
    assert.throws(() => resolveJwtSecret(), /ALLOW_INSECURE_DEV_AUTH_DEFAULTS/);
  });
});

test("rejeita hash configurado da senha default sem flag explicita", async () => {
  await withAuthEnv({
    NODE_ENV: "production",
    ADMIN_PASSWORD_HASH: hashSync("admin-local-change-me", 4),
  }, () => {
    assert.throws(
      () => resolveBootstrapAdminPasswordHash(),
      /ALLOW_INSECURE_DEV_AUTH_DEFAULTS/,
    );
  });
});

test("aceita segredo e hash customizados sem depender de NODE_ENV", async () => {
  const customHash = hashSync("senha-forte-de-teste", 4);
  await withAuthEnv({
    JWT_SECRET: "segredo-customizado-de-teste",
    ADMIN_PASSWORD_HASH: customHash,
  }, () => {
    assert.equal(resolveJwtSecret(), "segredo-customizado-de-teste");
    assert.equal(resolveBootstrapAdminPasswordHash(), customHash);
  });
});
