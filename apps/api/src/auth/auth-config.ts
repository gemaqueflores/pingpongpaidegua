import { compareSync, hashSync } from "bcryptjs";

const DEV_JWT_SECRET = "local-dev-jwt-secret-change-me";
const DEV_ADMIN_USERNAME = "admin-local";
const DEV_ADMIN_PASSWORD = "admin-local-change-me";

function isProduction(): boolean {
  return (process.env.NODE_ENV ?? "development") === "production";
}

function allowsInsecureDevAuthDefaults(): boolean {
  return process.env.ALLOW_INSECURE_DEV_AUTH_DEFAULTS?.trim() === "true";
}

function assertInsecureDefaultAllowed(variableName: string): void {
  if (!allowsInsecureDevAuthDefaults()) {
    throw new Error(
      `${variableName} usa default inseguro. ` +
        "Defina um valor seguro ou habilite explicitamente " +
        "ALLOW_INSECURE_DEV_AUTH_DEFAULTS=true apenas em desenvolvimento local/CI.",
    );
  }
}

export function resolveJwtSecret(): string {
  const configured = process.env.JWT_SECRET?.trim();
  if (configured) {
    if (configured === DEV_JWT_SECRET) {
      assertInsecureDefaultAllowed("JWT_SECRET");
    } else if (configured.length < 32) {
      throw new Error("JWT_SECRET deve ter no minimo 32 caracteres.");
    }
    return configured;
  }
  assertInsecureDefaultAllowed("JWT_SECRET");
  return DEV_JWT_SECRET;
}

export function resolveAdminUsername(): string {
  const configured = process.env.ADMIN_USERNAME?.trim();
  if (configured) {
    return configured;
  }
  if (isProduction()) {
    throw new Error("ADMIN_USERNAME obrigatorio em producao.");
  }
  return DEV_ADMIN_USERNAME;
}

export function resolveBootstrapAdminPasswordHash(): string {
  const configured = process.env.ADMIN_PASSWORD_HASH?.trim();
  if (configured) {
    if (compareSync(DEV_ADMIN_PASSWORD, configured)) {
      assertInsecureDefaultAllowed("ADMIN_PASSWORD_HASH");
    }
    return configured;
  }
  assertInsecureDefaultAllowed("ADMIN_PASSWORD_HASH");
  return hashSync(DEV_ADMIN_PASSWORD, 12);
}
