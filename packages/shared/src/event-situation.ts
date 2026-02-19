export type EventSituation =
  | "DRAFT"
  | "PRE_INSCRICOES"
  | "INSCRICOES_ABERTAS"
  | "POS_INSCRICOES_PRE_EVENTO"
  | "GRADES_PUBLICADAS_PRE_JOGO"
  | "EM_ANDAMENTO"
  | "POS_EVENTO";

export interface EventSituationInput {
  inicioInscricoes?: Date | string | null;
  fimInscricoes?: Date | string | null;
  inicioRealizacao?: Date | string | null;
  fimRealizacao?: Date | string | null;
  dataInicio?: Date | string | null;
  dataFim?: Date | string | null;
  hasPublishedMatches?: boolean | null;
  hasPublishedResults?: boolean | null;
}

export interface EventTimelineResolved {
  inicioInscricoes: Date | null;
  fimInscricoes: Date | null;
  inicioRealizacao: Date | null;
  fimRealizacao: Date | null;
}

export interface EventScrapePolicy {
  autoSchedule: boolean;
  captureInscricoes: boolean;
  captureGrupos: boolean;
  captureResultados: boolean;
  fetchEliminatoria: boolean;
  recommendedIntervalMs: number | null;
  reason: string;
}

export interface EventAutoScheduleDecision {
  due: boolean;
  elapsedMs: number | null;
  waitMs: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function isBusinessDay(date: Date): boolean {
  const day = date.getDay();
  return day !== 0 && day !== 6;
}

function addBusinessDays(base: Date, businessDays: number): Date {
  const cursor = new Date(base.getTime());
  if (businessDays <= 0) {
    return cursor;
  }

  let remaining = businessDays;
  while (remaining > 0) {
    cursor.setDate(cursor.getDate() + 1);
    if (isBusinessDay(cursor)) {
      remaining -= 1;
    }
  }
  return cursor;
}

function classifyPostRegistrationWindow(now: Date, fimInscricoes: Date): "INSCRICOES_ENCERRADAS" | "FORMACAO_GRUPOS" | "DEFINICAO_CONFRONTOS" {
  const cutoffInscricoesEncerradas = addBusinessDays(fimInscricoes, 2);
  if (now.getTime() <= cutoffInscricoesEncerradas.getTime()) {
    return "INSCRICOES_ENCERRADAS";
  }

  const inicioFormacao = addBusinessDays(fimInscricoes, 3);
  const fimFormacao = addBusinessDays(fimInscricoes, 5);
  if (now.getTime() >= inicioFormacao.getTime() && now.getTime() <= fimFormacao.getTime()) {
    return "FORMACAO_GRUPOS";
  }

  return "DEFINICAO_CONFRONTOS";
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function resolveEventTimeline(input: EventSituationInput): EventTimelineResolved {
  const inicioRealizacao = toDate(input.inicioRealizacao) ?? toDate(input.dataInicio);
  const fimRealizacao = toDate(input.fimRealizacao) ?? toDate(input.dataFim);

  return {
    inicioInscricoes: toDate(input.inicioInscricoes),
    fimInscricoes: toDate(input.fimInscricoes),
    inicioRealizacao,
    fimRealizacao,
  };
}

function isChronologyValid(timeline: EventTimelineResolved): boolean {
  const {
    inicioInscricoes,
    fimInscricoes,
    inicioRealizacao,
    fimRealizacao,
  } = timeline;

  if (!inicioInscricoes || !fimInscricoes || !inicioRealizacao || !fimRealizacao) {
    return false;
  }
  if (inicioInscricoes.getTime() > fimInscricoes.getTime()) {
    return false;
  }
  if (inicioRealizacao.getTime() > fimRealizacao.getTime()) {
    return false;
  }
  if (inicioInscricoes.getTime() > fimRealizacao.getTime()) {
    return false;
  }
  return true;
}

export function computeEventSituation(
  input: EventSituationInput,
  now: Date = new Date(),
): EventSituation {
  const timeline = resolveEventTimeline(input);
  if (!isChronologyValid(timeline)) {
    return "DRAFT";
  }

  const { inicioInscricoes, fimInscricoes, inicioRealizacao, fimRealizacao } = timeline;
  const nowMs = now.getTime();
  if (!inicioInscricoes || !fimInscricoes || !inicioRealizacao || !fimRealizacao) {
    return "DRAFT";
  }

  if (nowMs < inicioInscricoes.getTime()) {
    return "PRE_INSCRICOES";
  }
  if (nowMs <= fimInscricoes.getTime()) {
    return "INSCRICOES_ABERTAS";
  }
  if (nowMs < inicioRealizacao.getTime()) {
    if (Boolean(input.hasPublishedMatches) && !Boolean(input.hasPublishedResults)) {
      return "GRADES_PUBLICADAS_PRE_JOGO";
    }
    return "POS_INSCRICOES_PRE_EVENTO";
  }
  if (nowMs <= fimRealizacao.getTime()) {
    return "EM_ANDAMENTO";
  }
  return "POS_EVENTO";
}

export function getEventSituationTransition(
  input: EventSituationInput,
  now: Date = new Date(),
): Date | null {
  const timeline = resolveEventTimeline(input);
  const situation = computeEventSituation(input, now);

  switch (situation) {
    case "PRE_INSCRICOES":
      return timeline.inicioInscricoes;
    case "INSCRICOES_ABERTAS":
      return timeline.fimInscricoes;
    case "POS_INSCRICOES_PRE_EVENTO":
    case "GRADES_PUBLICADAS_PRE_JOGO":
      return timeline.inicioRealizacao;
    case "EM_ANDAMENTO":
      return timeline.fimRealizacao;
    default:
      return null;
  }
}

export function buildEventScrapePolicy(
  input: EventSituationInput,
  options: {
    now?: Date;
    isManualForce?: boolean;
    intervalBySituationMs?: Partial<Record<EventSituation, number>>;
  } = {},
): EventScrapePolicy {
  const now = options.now ?? new Date();
  const isManualForce = options.isManualForce ?? false;
  const timeline = resolveEventTimeline(input);
  const intervalBySituationMs = {
    PRE_INSCRICOES: 5 * 60 * 60 * 1000,
    INSCRICOES_ABERTAS: 6 * 60 * 60 * 1000,
    POS_INSCRICOES_PRE_EVENTO: 3 * 60 * 60 * 1000,
    GRADES_PUBLICADAS_PRE_JOGO: 45 * 60 * 1000,
    EM_ANDAMENTO: 20 * 60 * 1000,
    ...options.intervalBySituationMs,
  } satisfies Partial<Record<EventSituation, number>>;
  const situation = computeEventSituation(input, now);

  if (isManualForce) {
    return {
      autoSchedule: true,
      captureInscricoes: true,
      captureGrupos: true,
      captureResultados: true,
      fetchEliminatoria: true,
      recommendedIntervalMs: 0,
      reason: "manual-force",
    };
  }

  switch (situation) {
    case "DRAFT":
      return {
        autoSchedule: false,
        captureInscricoes: false,
        captureGrupos: false,
        captureResultados: false,
        fetchEliminatoria: false,
        recommendedIntervalMs: null,
        reason: "draft-no-auto-scrape",
      };
    case "PRE_INSCRICOES":
      return {
        autoSchedule: true,
        captureInscricoes: true,
        captureGrupos: false,
        captureResultados: false,
        fetchEliminatoria: false,
        recommendedIntervalMs: intervalBySituationMs.PRE_INSCRICOES ?? 5 * 60 * 60 * 1000,
        reason: "pre-inscricoes-redundante",
      };
    case "INSCRICOES_ABERTAS":
      return {
        autoSchedule: true,
        captureInscricoes: true,
        captureGrupos: false,
        captureResultados: false,
        fetchEliminatoria: false,
        recommendedIntervalMs: intervalBySituationMs.INSCRICOES_ABERTAS ?? 5 * 60 * 60 * 1000,
        reason: "inscricoes-abertas",
      };
    case "POS_INSCRICOES_PRE_EVENTO":
      if (!timeline.fimInscricoes) {
        return {
          autoSchedule: true,
          captureInscricoes: true,
          captureGrupos: true,
          captureResultados: false,
          fetchEliminatoria: false,
          recommendedIntervalMs:
            intervalBySituationMs.POS_INSCRICOES_PRE_EVENTO ?? 3 * 60 * 60 * 1000,
          reason: "pos-inscricoes-pre-evento",
        };
      }

      switch (classifyPostRegistrationWindow(now, timeline.fimInscricoes)) {
        case "INSCRICOES_ENCERRADAS":
          return {
            autoSchedule: true,
            captureInscricoes: true,
            captureGrupos: false,
            captureResultados: false,
            fetchEliminatoria: false,
            recommendedIntervalMs: 6 * 60 * 60 * 1000,
            reason: "inscricoes-encerradas-sanitizacao",
          };
        case "FORMACAO_GRUPOS":
          return {
            autoSchedule: true,
            captureInscricoes: true,
            captureGrupos: true,
            captureResultados: true,
            fetchEliminatoria: true,
            recommendedIntervalMs: 2 * 60 * 60 * 1000,
            reason: "formacao-de-grupos",
          };
        case "DEFINICAO_CONFRONTOS":
        default:
          return {
            autoSchedule: true,
            captureInscricoes: false,
            captureGrupos: true,
            captureResultados: true,
            fetchEliminatoria: true,
            recommendedIntervalMs:
              intervalBySituationMs.POS_INSCRICOES_PRE_EVENTO ?? 3 * 60 * 60 * 1000,
            reason: "definicao-de-confrontos",
          };
      }
    case "GRADES_PUBLICADAS_PRE_JOGO":
      return {
        autoSchedule: true,
        captureInscricoes: false,
        captureGrupos: true,
        captureResultados: true,
        fetchEliminatoria: true,
        recommendedIntervalMs:
          intervalBySituationMs.GRADES_PUBLICADAS_PRE_JOGO ?? 45 * 60 * 1000,
        reason: "grades-publicadas-pre-jogo",
      };
    case "EM_ANDAMENTO":
      return {
        autoSchedule: true,
        captureInscricoes: false,
        captureGrupos: false,
        captureResultados: true,
        fetchEliminatoria: true,
        recommendedIntervalMs: intervalBySituationMs.EM_ANDAMENTO ?? 30 * 60 * 1000,
        reason: "em-andamento",
      };
    case "POS_EVENTO":
      if (timeline.fimRealizacao) {
        const elapsedAfterFinishMs = now.getTime() - timeline.fimRealizacao.getTime();
        if (elapsedAfterFinishMs >= 0 && elapsedAfterFinishMs <= DAY_MS) {
          return {
            autoSchedule: true,
            captureInscricoes: false,
            captureGrupos: false,
            captureResultados: true,
            fetchEliminatoria: true,
            recommendedIntervalMs: 2 * 60 * 60 * 1000,
            reason: "pos-evento-imediato-consolidacao",
          };
        }
      }
      return {
        autoSchedule: false,
        captureInscricoes: false,
        captureGrupos: false,
        captureResultados: false,
        fetchEliminatoria: false,
        recommendedIntervalMs: null,
        reason: "pos-evento-encerrado",
      };
    default:
      return {
        autoSchedule: false,
        captureInscricoes: false,
        captureGrupos: false,
        captureResultados: false,
        fetchEliminatoria: false,
        recommendedIntervalMs: null,
        reason: "unknown",
      };
  }
}

export function shouldRunEventAutoScrape(
  lastScrapeAt: Date | string | null | undefined,
  policy: EventScrapePolicy,
  now: Date = new Date(),
): EventAutoScheduleDecision {
  if (!policy.autoSchedule) {
    return {
      due: false,
      elapsedMs: null,
      waitMs: 0,
    };
  }

  const intervalMs = policy.recommendedIntervalMs ?? 0;
  if (intervalMs <= 0) {
    return {
      due: true,
      elapsedMs: null,
      waitMs: 0,
    };
  }

  const parsed = toDate(lastScrapeAt);
  if (!parsed) {
    return {
      due: true,
      elapsedMs: null,
      waitMs: 0,
    };
  }

  const elapsedMs = Math.max(0, now.getTime() - parsed.getTime());
  const waitMs = Math.max(0, intervalMs - elapsedMs);
  return {
    due: waitMs === 0,
    elapsedMs,
    waitMs,
  };
}
