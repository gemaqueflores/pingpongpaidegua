const API_BASE_PUBLIC = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const API_BASE_INTERNAL =
  process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const ADMIN_TOKEN_KEY = "cbtm_admin_token";
const ADMIN_ROLE_KEY = "cbtm_admin_role";
const LEGACY_TOKEN_KEY = "cbtm_token";
const LEGACY_ROLE_KEY = "cbtm_role";

export type AuthRole = "ADMIN";

function currentStorage(): Storage {
  return window.sessionStorage;
}

function legacyStorage(): Storage {
  return window.localStorage;
}

export function getApiBase(): string {
  if (typeof window === "undefined") {
    return API_BASE_INTERNAL;
  }
  return API_BASE_PUBLIC;
}

export function getAuthToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  const storage = currentStorage();
  const legacy = legacyStorage();
  const current = storage.getItem(ADMIN_TOKEN_KEY);
  if (current) {
    return current;
  }

  const legacyToken = legacy.getItem(LEGACY_TOKEN_KEY);
  if (!legacyToken) {
    return null;
  }

  // Migra sessão legada para chave de sessão (expira ao fechar navegador).
  storage.setItem(ADMIN_TOKEN_KEY, legacyToken);
  legacy.removeItem(LEGACY_TOKEN_KEY);
  return legacyToken;
}

export function setAuthToken(token: string): void {
  if (typeof window === "undefined") {
    return;
  }
  const storage = currentStorage();
  const legacy = legacyStorage();
  storage.setItem(ADMIN_TOKEN_KEY, token);
  legacy.removeItem(LEGACY_TOKEN_KEY);
}

export function setUserRole(role: AuthRole): void {
  if (typeof window === "undefined") {
    return;
  }
  const storage = currentStorage();
  const legacy = legacyStorage();
  storage.setItem(ADMIN_ROLE_KEY, role);
  legacy.removeItem(LEGACY_ROLE_KEY);
}

export function getUserRole(): AuthRole | null {
  if (typeof window === "undefined") {
    return null;
  }
  const storage = currentStorage();
  const legacy = legacyStorage();
  const current = storage.getItem(ADMIN_ROLE_KEY);
  if (current === "ADMIN") {
    return "ADMIN";
  }

  const legacyRole = legacy.getItem(LEGACY_ROLE_KEY);
  if (legacyRole !== "ADMIN") {
    return null;
  }

  storage.setItem(ADMIN_ROLE_KEY, "ADMIN");
  legacy.removeItem(LEGACY_ROLE_KEY);
  return "ADMIN";
}

export function clearAuth(): void {
  if (typeof window === "undefined") {
    return;
  }
  const storage = currentStorage();
  const legacy = legacyStorage();
  storage.removeItem(ADMIN_TOKEN_KEY);
  storage.removeItem(ADMIN_ROLE_KEY);
  legacy.removeItem(LEGACY_TOKEN_KEY);
  legacy.removeItem(LEGACY_ROLE_KEY);
}

export function getHeaders(): HeadersInit {
  const token = getAuthToken();
  const headers: HeadersInit = {
    "Content-Type": "application/json",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

export async function handleResponse(response: Response) {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Erro HTTP ${response.status}`);
  }

  return response.json();
}
