import { fetchWithRecovery, getApiBase, getHeaders, handleResponse } from "./auth";

const API_BASE = getApiBase();

export type EventSituation =
  | "DRAFT"
  | "PRE_INSCRICOES"
  | "INSCRICOES_ABERTAS"
  | "POS_INSCRICOES_PRE_EVENTO"
  | "GRADES_PUBLICADAS_PRE_JOGO"
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
  totalPartidasPublicadas?: number;
  totalPartidasPrevistas?: number;
  totalPartidas?: number;
  totalPartidasCalculadas?: number;
  totalPartidasWo?: number;
  totalPartidasJogadas?: number;
  totalTecnicos: number;
  inscricoesTotaisOficiais?: number;
  associacoesAtletaCategoria?: number;
  associacoesTecnicoClube?: number;
  participantesUnicos?: number;
  groupsDefined: boolean;
  userStatus: UserEventStatus;
  groupSimulationEligible: boolean;
}

export interface UserClubRow {
  id: number;
  name: string;
  athleteCount?: number;
}

export interface EventEfficiencyRow {
  clubId: number;
  clubName: string;
  athleteCount: number;
  ouro: number;
  prata: number;
  bronze: number;
  totalQuantidade: number;
  totalPontuacao: number;
  pontuacao: {
    ouro: number;
    prata: number;
    bronze: number;
    total: number;
  };
}

export interface EventEfficiencyResponse {
  eventId: number;
  weights: {
    pesoOuro: number;
    pesoPrata: number;
    pesoBronze: number;
  };
  ranking: EventEfficiencyRow[];
}

export interface EventCategoryMedalistsResponse {
  eventId: number;
  categories: Array<{
    categoryId: number;
    categoryName: string;
    athleteCount: number;
    officialRegisteredCount?: number | null;
    officialPreRegisteredCount?: number | null;
    officialTotalListedCount?: number | null;
    expectedMedalists?: number | null;
    publishedMatchesCount?: number;
    calculatedMatchesCount?: number;
    walkoverMatchesCount?: number;
    playedMatchesCount?: number;
    medalists: Array<{
      athleteId: number;
      athleteName: string;
      clubName: string | null;
      position: number;
      medalha: "ouro" | "prata" | "bronze";
    }>;
  }>;
}

export interface GlobalEfficiencyResponse {
  weights: {
    pesoOuro: number;
    pesoPrata: number;
    pesoBronze: number;
  };
  ranking: EventEfficiencyRow[];
}

export type EfficiencyCompetitionType = "BRASILEIRAO" | "COPA" | "ESTADUAL" | "OPEN";

export interface ClubEfficiencyCareerResponse {
  club: {
    id: number;
    name: string;
  };
  weights: {
    pesoOuro: number;
    pesoPrata: number;
    pesoBronze: number;
  };
  summary: {
    nEventos: number;
    ultimoEventoNome: string | null;
    ultimoEventoId: number | null;
    nAtletasUltimoEvento: number;
    proximoEventoNome: string | null;
    proximoEventoId: number | null;
    nAtletasProximoEvento: number;
    medalhasTotais: {
      ouro: number;
      prata: number;
      bronze: number;
      total: number;
    };
  };
  broadcastByType: Record<
    EfficiencyCompetitionType,
    {
      ouro: number;
      prata: number;
      bronze: number;
      total: number;
    }
  >;
  scoreCard: {
    quantidade: {
      ouro: number;
      prata: number;
      bronze: number;
      total: number;
    };
    pontuacao: {
      ouro: number;
      prata: number;
      bronze: number;
      total: number;
    };
  };
  history: Array<{
    eventId: number;
    eventName: string;
    eventType: EfficiencyCompetitionType;
    dataInicio: string | null;
    dataFim: string | null;
    athleteCount: number;
    ouro: number;
    prata: number;
    bronze: number;
    totalQuantidade: number;
    pontuacao: {
      ouro: number;
      prata: number;
      bronze: number;
      total: number;
    };
    medalists: Array<{
      athleteId: number;
      athleteName: string;
      categoryName: string;
      medalha: "ouro" | "prata" | "bronze";
    }>;
  }>;
  athletesContribution: Array<{
    athleteId: number;
    athleteName: string;
    eventos: number;
    ouro: number;
    prata: number;
    bronze: number;
    totalQuantidade: number;
    pontuacao: {
      ouro: number;
      prata: number;
      bronze: number;
      total: number;
    };
  }>;
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
  matchups: Array<{
    matchName: string;
    blockName: string;
    athleteA: {
      athleteId: number;
      nameDisplay: string;
      nameReduced: string;
      clubName: string | null;
      rankingPoints: number | null;
      ratingPoints: number | null;
    } | null;
    athleteB: {
      athleteId: number;
      nameDisplay: string;
      nameReduced: string;
      clubName: string | null;
      rankingPoints: number | null;
      ratingPoints: number | null;
    } | null;
    athleteASeed: number | null;
    athleteBSeed: number | null;
    isBye: boolean;
  }>;
  stats: {
    structureType?: "groups" | "knockout";
    sortBasis?: "rating" | "ranking";
    primaryFieldUsed?: "ratingPoints" | "rankingPoints";
    fallbackUsedCount?: number;
    seed: string;
    distributionMode: "ZIGUE_ZAGUE_INVERTIDO" | "K1_BLOCOS";
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
    seededAthleteCount?: number;
    bracketSize?: number;
    byeCount?: number;
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
  const response = await fetchWithRecovery(`${API_BASE}/events`, {
    headers: getHeaders(),
    cache: "no-store",
  });

  return handleResponse(response);
}

export async function apiGetEventSummary(eventId: number): Promise<UserEventRow> {
  const response = await fetchWithRecovery(`${API_BASE}/events/${eventId}`, {
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

  const response = await fetchWithRecovery(`${API_BASE}/events/${eventId}/athletes?${query.toString()}`, {
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
  const response = await fetchWithRecovery(`${API_BASE}/events/${eventId}/clubs${suffix}`, {
    headers: getHeaders(),
    cache: "no-store",
  });

  return handleResponse(response) as Promise<UserClubRow[]>;
}

export async function apiGetCategories(eventId: number) {
  const response = await fetchWithRecovery(`${API_BASE}/events/${eventId}/categories`, {
    headers: getHeaders(),
  });

  return handleResponse(response);
}

export async function apiGetEventEfficiency(eventId: number): Promise<EventEfficiencyResponse> {
  const response = await fetchWithRecovery(`${API_BASE}/events/${eventId}/efficiency`, {
    headers: getHeaders(),
    cache: "no-store",
  });

  return handleResponse(response);
}

export async function apiGetEventCategoryMedalists(eventId: number): Promise<EventCategoryMedalistsResponse> {
  const response = await fetchWithRecovery(`${API_BASE}/events/${eventId}/medalists`, {
    headers: getHeaders(),
    cache: "no-store",
  });

  return handleResponse(response);
}

export async function apiGetGlobalEfficiency(): Promise<GlobalEfficiencyResponse> {
  const response = await fetchWithRecovery(`${API_BASE}/efficiency`, {
    headers: getHeaders(),
    cache: "no-store",
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
  const response = await fetchWithRecovery(`${API_BASE}/events/${eventId}/group-simulation${suffix}`, {
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
  const response = await fetchWithRecovery(`${API_BASE}/events/${eventId}/clubs/${clubId}/athletes${suffix}`, {
    headers: getHeaders(),
    cache: "no-store",
  });

  return handleResponse(response);
}

export async function apiGetAthleteSummary(
  eventId: number,
  athleteId: number,
  orderBy: "phase_hierarchy_datetime" | "category_phase_datetime",
) {
  const response = await fetchWithRecovery(
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
  const response = await fetchWithRecovery(`${API_BASE}/athletes/directory${suffix}`, {
    headers: getHeaders(),
    cache: "no-store",
  });

  return handleResponse(response);
}

export async function apiGetAthleteCareer(athleteKey: string) {
  const response = await fetchWithRecovery(`${API_BASE}/athletes/${encodeURIComponent(athleteKey)}/career`, {
    headers: getHeaders(),
    cache: "no-store",
  });

  return handleResponse(response);
}

export async function apiGetClubEfficiencyCareer(clubId: number): Promise<ClubEfficiencyCareerResponse> {
  const response = await fetchWithRecovery(`${API_BASE}/clubs/${clubId}/efficiency-career`, {
    headers: getHeaders(),
    cache: "no-store",
  });

  return handleResponse(response);
}

export async function apiReportProblem(input: { title: string; description: string }) {
  const response = await fetchWithRecovery(`${API_BASE}/support/report-problem`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(input),
  });

  return handleResponse(response);
}

