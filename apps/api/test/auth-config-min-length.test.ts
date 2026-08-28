import test from "node:test";
import assert from "node:assert/strict";
import { resolveJwtSecret } from "../src/auth/auth-config";

const ENV_KEYS = ["JWT_SECRET", "ALLOW_INSECURE_DEV_AUTH_DEFAULTS"] as const;

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

test("T-U-01: rejeita JWT_SECRET customizado com menos de 32 caracteres", async () => {
  const shortSecret = "abc12345";

  await withAuthEnv({ JWT_SECRET: shortSecret }, () => {
    assert.throws(() => resolveJwtSecret(), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /32/);
      assert.doesNotMatch(error.message, new RegExp(shortSecret));
      return true;
    });
  });
});

test("T-U-02: aceita JWT_SECRET customizado com exatamente 32 caracteres", async () => {
  const minimumLengthSecret = "a".repeat(32);

  await withAuthEnv({ JWT_SECRET: minimumLengthSecret }, () => {
    assert.equal(resolveJwtSecret(), minimumLengthSecret);
  });
});

test("T-U-03: rejeita JWT_SECRET customizado com exatamente 31 caracteres", async () => {
  await withAuthEnv({ JWT_SECRET: "a".repeat(31) }, () => {
    assert.throws(() => resolveJwtSecret(), /32/);
  });
});
