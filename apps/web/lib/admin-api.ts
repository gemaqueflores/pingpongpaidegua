import { getApiBase, getHeaders, handleResponse } from "./auth";

const API_BASE = getApiBase();

export type EventLevel = "ESTADUAL" | "COPA" | "NACIONAL" | "OPEN";
export type EventSituation =
  | "DRAFT"
  | "PRE_INSCRICOES"
  | "INSCRICOES_ABERTAS"
  | "POS_INSCRICOES_PRE_EVENTO"
  | "GRADES_PUBLICADAS_PRE_JOGO"
  | "EM_ANDAMENTO"
  | "POS_EVENTO";

export interface AdminEventPayload {
  cbtmEventId: number;
  nome: string;
  nivel?: EventLevel | null;
  inicioInscricoes?: string | null;
  fimInscricoes?: string | null;
  inicioRealizacao?: string | null;
  fimRealizacao?: string | null;
  dataInicio?: string | null;
  dataFim?: string | null;
  concluido?: boolean;
}

export interface AdminEventRow {
  id: number;
  cbtmEventId: number;
  nome: string;
  nivel: EventLevel | null;
  inicioInscricoes: string | null;
  fimInscricoes: string | null;
  inicioRealizacao: string | null;
  fimRealizacao: string | null;
  dataInicio: string | null;
  dataFim: string | null;
  concluido: boolean;
  lastScrapeAt: string | null;
  situacaoComputada?: EventSituation;
  proximaMudanca?: string | null;
  _count?: {
    scrapeRuns: number;
    athletes: number;
    categories: number;
    matches: number;
    athleteMatchConflicts: number;
  };
}

export interface EfficiencyConfig {
  id: number;
  pesoOuro: number;
  pesoPrata: number;
  pesoBronze: number;
}

export async function apiLogin(username: string, password: string) {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ username, password }),
  });

  return handleResponse(response);
}

export async function apiForgotPassword(username?: string) {
  const response = await fetch(`${API_BASE}/auth/forgot-password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ username }),
  });

  return handleResponse(response);
}

export async function apiResetPassword(token: string, password: string) {
  const response = await fetch(`${API_BASE}/auth/reset-password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ token, password }),
  });

  return handleResponse(response);
}

export async function apiGetAdminEvents(): Promise<AdminEventRow[]> {
  const response = await fetch(`${API_BASE}/admin/events`, {
    headers: getHeaders(),
    cache: "no-store",
  });

  return handleResponse(response);
}

export async function apiCreateEvent(payload: AdminEventPayload): Promise<AdminEventRow> {
  const response = await fetch(`${API_BASE}/admin/events`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(payload),
  });

  return handleResponse(response);
}

export async function apiUpdateEvent(id: number, payload: Partial<AdminEventPayload>): Promise<AdminEventRow> {
  const response = await fetch(`${API_BASE}/admin/events/${id}`, {
    method: "PUT",
    headers: getHeaders(),
    body: JSON.stringify(payload),
  });

  return handleResponse(response);
}

export async function apiMarkCompleted(id: number) {
  const response = await fetch(`${API_BASE}/admin/events/${id}/mark-completed`, {
    method: "POST",
    headers: getHeaders(),
  });

  return handleResponse(response);
}

export async function apiScrapeNow(id: number, stage?: 1 | 2 | 3) {
  const url = new URL(`${API_BASE}/admin/events/${id}/scrape-now`);
  if (stage) {
    url.searchParams.set("stage", String(stage));
  }

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: getHeaders(),
    body: stage ? JSON.stringify({ stage }) : JSON.stringify({}),
  });

  return handleResponse(response);
}

export async function apiDeleteEvent(id: number) {
  const response = await fetch(`${API_BASE}/admin/events/${id}`, {
    method: "DELETE",
    headers: getHeaders(),
  });

  return handleResponse(response);
}

export async function apiGetScrapeRuns(id: number) {
  const cacheBust = Date.now();
  const response = await fetch(`${API_BASE}/admin/events/${id}/scrape-runs?_ts=${cacheBust}`, {
    headers: getHeaders(),
    cache: "no-store",
  });

  return handleResponse(response);
}

export async function apiGetAthleteConflicts(id: number) {
  const cacheBust = Date.now();
  const response = await fetch(`${API_BASE}/admin/events/${id}/athlete-conflicts?_ts=${cacheBust}`, {
    headers: getHeaders(),
    cache: "no-store",
  });

  return handleResponse(response);
}

export async function apiResolveAthleteConflict(eventId: number, conflictId: number, athleteId: number) {
  const response = await fetch(`${API_BASE}/admin/events/${eventId}/athlete-conflicts/${conflictId}/resolve`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ athleteId }),
  });

  return handleResponse(response);
}

export async function apiGetEfficiencyConfig(): Promise<EfficiencyConfig> {
  const response = await fetch(`${API_BASE}/admin/events/efficiency-config`, {
    headers: getHeaders(),
    cache: "no-store",
  });

  return handleResponse(response);
}

export async function apiUpdateEfficiencyConfig(payload: {
  pesoOuro: number;
  pesoPrata: number;
  pesoBronze: number;
}): Promise<EfficiencyConfig> {
  const response = await fetch(`${API_BASE}/admin/events/efficiency-config`, {
    method: "PUT",
    headers: getHeaders(),
    body: JSON.stringify(payload),
  });

  return handleResponse(response);
}
