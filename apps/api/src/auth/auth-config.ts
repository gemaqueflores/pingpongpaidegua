import { hashSync } from "bcryptjs";

const DEV_JWT_SECRET = "local-dev-jwt-secret-change-me";
const DEV_ADMIN_USERNAME = "admin-local";
const DEV_ADMIN_PASSWORD = "admin-local-change-me";

function isProduction(): boolean {
  return (process.env.NODE_ENV ?? "development") === "production";
}

export function resolveJwtSecret(): string {
  const configured = process.env.JWT_SECRET?.trim();
  if (configured) {
    return configured;
  }
  if (isProduction()) {
    throw new Error("JWT_SECRET obrigatorio em producao.");
  }
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
    return configured;
  }
  if (isProduction()) {
    throw new Error("ADMIN_PASSWORD_HASH obrigatorio em producao.");
  }
  return hashSync(DEV_ADMIN_PASSWORD, 12);
}
