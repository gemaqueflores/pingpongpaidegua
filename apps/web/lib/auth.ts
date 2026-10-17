const API_BASE_PUBLIC = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const API_BASE_INTERNAL =
  process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const ADMIN_TOKEN_KEY = "cbtm_admin_token";
const ADMIN_ROLE_KEY = "cbtm_admin_role";
const LEGACY_TOKEN_KEY = "cbtm_token";
const LEGACY_ROLE_KEY = "cbtm_role";
const DEFAULT_FETCH_TIMEOUT_MS = 15000;
const DEFAULT_FETCH_RETRIES = 2;
const DEFAULT_FETCH_BACKOFF_MS = 500;

export type AuthRole = "ADMIN";

// PP-SEC-011 (B2): sessionStorage reduz a persistência ao encerrar a aba,
// mas é mitigação residual: um XSS ainda pode ler o token via JavaScript.
// Cookie httpOnly aguarda topologia same-site (PEND-CBTM-001).
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

// PP-SEC-011: manter escrita exclusiva em sessionStorage, sem promover o token
// de volta a localStorage; a remoção abaixo apenas limpa o resíduo legado.
// A leitura e migração de sessões legadas em getAuthToken permanece compatível.
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

export interface FetchRecoveryOptions {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function isNetworkError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const message = "message" in error ? String(error.message ?? "") : "";
  const name = "name" in error ? String(error.name ?? "") : "";
  if (name === "AbortError") {
    return true;
  }

  return message.toLowerCase().includes("failed to fetch") || message.toLowerCase().includes("network");
}

function isSafeMethod(method: string | undefined): boolean {
  const normalized = String(method ?? "GET").trim().toUpperCase();
  return normalized === "GET" || normalized === "HEAD" || normalized === "OPTIONS";
}

export async function fetchWithRecovery(
  input: string | URL,
  init?: RequestInit,
  options?: FetchRecoveryOptions,
): Promise<Response> {
  const timeoutMs = Math.max(1000, options?.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
  const retries = Math.max(0, options?.retries ?? DEFAULT_FETCH_RETRIES);
  const retryDelayMs = Math.max(100, options?.retryDelayMs ?? DEFAULT_FETCH_BACKOFF_MS);
  const method = String(init?.method ?? "GET").trim().toUpperCase();
  const retryUnsafeRequests = !isSafeMethod(method);

  let lastError: unknown = null;
  let lastResponse: Response | null = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const abortController = new AbortController();
    const timer = setTimeout(() => {
      abortController.abort();
    }, timeoutMs);

    try {
      const response = await fetch(input, {
        ...init,
        signal: abortController.signal,
      });
      clearTimeout(timer);

      if (!response.ok && isTransientStatus(response.status) && attempt < retries && !retryUnsafeRequests) {
        await sleep(retryDelayMs * (attempt + 1));
        continue;
      }

      if (!response.ok && isTransientStatus(response.status) && attempt < retries && retryUnsafeRequests) {
        lastResponse = response;
        break;
      }

      return response;
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      if (!isNetworkError(error)) {
        throw error;
      }

      if (attempt >= retries || retryUnsafeRequests) {
        break;
      }

      await sleep(retryDelayMs * (attempt + 1));
    }
  }

  if (lastResponse) {
    return lastResponse;
  }

  throw lastError instanceof Error ? lastError : new Error("Falha de conexao com a API.");
}
