import { getApiBase, getHeaders, handleResponse } from "./auth";

const API_BASE = getApiBase();

export type EventSituation =
  | "DRAFT"
  | "PRE_INSCRICOES"
  | "INSCRICOES_ABERTAS"
  | "POS_INSCRICOES_PRE_EVENTO"
  | "EM_ANDAMENTO"
  | "POS_EVENTO";

export type UserEventStatus = "INSCRICOES_ABERTAS" | "INSCRICOES_ENCERRADAS" | "CONCLUIDO";
export type GroupSimulationScope = "confirmed" | "confirmed_and_pre";

export interface UserEventRow {
  id: number;
  cbtmEventId: number;
  nome: string;
  nivel: "ESTADUAL" | "COPA" | "NACIONAL" | "OPEN" | null;
  inicioInscricoes: string | null;
  fimInscricoes: string | null;
  inicioRealizacao: string | null;
  fimRealizacao: string | null;
  dataInicio: string | null;
  dataFim: string | null;
  concluido: boolean;
  lastScrapeAt: string | null;
  situacaoComputada: EventSituation;
  totalCategorias: number;
  totalInscritos: number;
  totalTecnicos: number;
  groupsDefined: boolean;
  userStatus: UserEventStatus;
  groupSimulationEligible: boolean;
}

export interface UserClubRow {
  id: number;
  name: string;
  athleteCount?: number;
}

export interface GroupSimulationCategory {
  categoryId: number;
  categoryName: string;
  status: "simulated" | "skipped";
  reason: string | null;
  groups: Array<{
    groupName: string;
    athletes: Array<{
      athleteId: number;
      nameDisplay: string;
      nameReduced: string;
      clubName: string | null;
      rankingPoints: number | null;
      ratingPoints: number | null;
    }>;
  }>;
  stats: {
    sortBasis?: "rating" | "ranking";
    primaryFieldUsed?: "ratingPoints" | "rankingPoints";
    fallbackUsedCount?: number;
    seed: string;
    distributionMode: "ZIGUE_ZAGUE_INVERTIDO";
    athleteCount: number;
    groupCount: number;
    minGroupSize: number;
    maxGroupSize: number;
    clubCollisionPairs: number;
    clubCollisionsInevitable: number;
    collisionsBefore: number;
    collisionsAfter: number;
    swapsApplied: number;
    iterations: number;
    initialDistribution: Array<{
      groupName: string;
      athleteIds: number[];
    }>;
    historicalPreferredGroupCount: number | null;
    historicalSampleSize?: number;
  } | null;
  registration: {
    scope: GroupSimulationScope;
    total: number;
    confirmed: number;
    preInscrito: number;
    other: number;
    unknown: number;
    linkedAthletesCount?: number;
    scopedAthletesCount?: number;
    considered: number;
    consideredAthleteIds?: number[];
  };
  warnings: string[];
}

export interface GroupSimulationResponse {
  eventId: number;
  eventSituation: EventSituation;
  groupsDefined: boolean;
  registrationScope: GroupSimulationScope;
  warnings: string[];
  categories: GroupSimulationCategory[];
}

export async function apiGetEvents(): Promise<UserEventRow[]> {
  const response = await fetch(`${API_BASE}/events`, {
    headers: getHeaders(),
    cache: "no-store",
  });

  return handleResponse(response);
}

export async function apiGetAthletes(eventId: number, search: string) {
  const query = new URLSearchParams();
  if (search) {
    query.set("search", search);
  }

  const response = await fetch(`${API_BASE}/events/${eventId}/athletes?${query.toString()}`, {
    headers: getHeaders(),
  });

  return handleResponse(response);
}

export async function apiGetClubs(eventId: number, search = "", categoryId?: number) {
  const query = new URLSearchParams();
  if (search) {
    query.set("search", search);
  }
  if (typeof categoryId === "number") {
    query.set("categoryId", String(categoryId));
  }

  const suffix = query.toString() ? `?${query.toString()}` : "";
  const response = await fetch(`${API_BASE}/events/${eventId}/clubs${suffix}`, {
    headers: getHeaders(),
  });

  return handleResponse(response) as Promise<UserClubRow[]>;
}

export async function apiGetCategories(eventId: number) {
  const response = await fetch(`${API_BASE}/events/${eventId}/categories`, {
    headers: getHeaders(),
  });

  return handleResponse(response);
}

export async function apiGetGroupSimulation(
  eventId: number,
  options?: { categoryId?: number; registrationScope?: GroupSimulationScope; debug?: boolean },
): Promise<GroupSimulationResponse> {
  const query = new URLSearchParams();
  if (typeof options?.categoryId === "number") {
    query.set("categoryId", String(options.categoryId));
  }
  if (options?.registrationScope) {
    query.set("registrationScope", options.registrationScope);
  }
  if (options?.debug) {
    query.set("debug", "1");
  }
  const suffix = query.toString() ? `?${query.toString()}` : "";
  const response = await fetch(`${API_BASE}/events/${eventId}/group-simulation${suffix}`, {
    headers: getHeaders(),
    cache: "no-store",
  });

  return handleResponse(response);
}

export async function apiGetClubAthletes(eventId: number, clubId: number, categoryId?: number) {
  const query = new URLSearchParams();
  if (typeof categoryId === "number") {
    query.set("categoryId", String(categoryId));
  }

  const suffix = query.toString() ? `?${query.toString()}` : "";
  const response = await fetch(`${API_BASE}/events/${eventId}/clubs/${clubId}/athletes${suffix}`, {
    headers: getHeaders(),
  });

  return handleResponse(response);
}

export async function apiGetAthleteSummary(
  eventId: number,
  athleteId: number,
  orderBy: "phase_hierarchy_datetime" | "category_phase_datetime",
) {
  const response = await fetch(
    `${API_BASE}/events/${eventId}/athletes/${athleteId}/summary?orderBy=${orderBy}`,
    {
      headers: getHeaders(),
    },
  );

  return handleResponse(response);
}

export async function apiGetAthletesDirectory(search = "") {
  const query = new URLSearchParams();
  if (search) {
    query.set("search", search);
  }

  const suffix = query.toString() ? `?${query.toString()}` : "";
  const response = await fetch(`${API_BASE}/athletes/directory${suffix}`, {
    headers: getHeaders(),
    cache: "no-store",
  });

  return handleResponse(response);
}

export async function apiGetAthleteCareer(athleteKey: string) {
  const response = await fetch(`${API_BASE}/athletes/${encodeURIComponent(athleteKey)}/career`, {
    headers: getHeaders(),
    cache: "no-store",
  });

  return handleResponse(response);
}

export async function apiReportProblem(input: { title: string; description: string }) {
  const response = await fetch(`${API_BASE}/support/report-problem`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(input),
  });

  return handleResponse(response);
}
