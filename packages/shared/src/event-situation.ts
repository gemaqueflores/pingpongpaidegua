export type EventSituation =
  | "DRAFT"
  | "PRE_INSCRICOES"
  | "INSCRICOES_ABERTAS"
  | "POS_INSCRICOES_PRE_EVENTO"
  | "EM_ANDAMENTO"
  | "POS_EVENTO";

export interface EventSituationInput {
  inicioInscricoes?: Date | string | null;
  fimInscricoes?: Date | string | null;
  inicioRealizacao?: Date | string | null;
  fimRealizacao?: Date | string | null;
  dataInicio?: Date | string | null;
  dataFim?: Date | string | null;
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
  reason: string;
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
    postEventGraceHours?: number;
  } = {},
): EventScrapePolicy {
  const now = options.now ?? new Date();
  const isManualForce = options.isManualForce ?? false;
  const postEventGraceHours = Math.max(0, options.postEventGraceHours ?? 48);
  const timeline = resolveEventTimeline(input);
  const situation = computeEventSituation(input, now);

  if (isManualForce) {
    return {
      autoSchedule: true,
      captureInscricoes: true,
      captureGrupos: true,
      captureResultados: true,
      fetchEliminatoria: true,
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
        reason: "draft-no-auto-scrape",
      };
    case "PRE_INSCRICOES":
      return {
        autoSchedule: true,
        captureInscricoes: true,
        captureGrupos: false,
        captureResultados: false,
        fetchEliminatoria: false,
        reason: "pre-inscricoes",
      };
    case "INSCRICOES_ABERTAS":
      return {
        autoSchedule: true,
        captureInscricoes: true,
        captureGrupos: true,
        captureResultados: false,
        fetchEliminatoria: false,
        reason: "inscricoes-abertas",
      };
    case "POS_INSCRICOES_PRE_EVENTO":
      return {
        autoSchedule: true,
        captureInscricoes: true,
        captureGrupos: true,
        captureResultados: false,
        fetchEliminatoria: false,
        reason: "pos-inscricoes-pre-evento",
      };
    case "EM_ANDAMENTO":
      return {
        autoSchedule: true,
        captureInscricoes: false,
        captureGrupos: true,
        captureResultados: true,
        fetchEliminatoria: true,
        reason: "em-andamento",
      };
    case "POS_EVENTO": {
      const fimRealizacao = timeline.fimRealizacao;
      if (!fimRealizacao) {
        return {
          autoSchedule: false,
          captureInscricoes: false,
          captureGrupos: false,
          captureResultados: false,
          fetchEliminatoria: false,
          reason: "pos-evento-sem-data-final",
        };
      }

      const graceMs = postEventGraceHours * 60 * 60 * 1000;
      const insideGrace = now.getTime() - fimRealizacao.getTime() <= graceMs;
      if (insideGrace) {
        return {
          autoSchedule: true,
          captureInscricoes: false,
          captureGrupos: false,
          captureResultados: true,
          fetchEliminatoria: true,
          reason: "pos-evento-grace",
        };
      }

      return {
        autoSchedule: false,
        captureInscricoes: false,
        captureGrupos: false,
        captureResultados: false,
        fetchEliminatoria: false,
        reason: "pos-evento-expirado",
      };
    }
    default:
      return {
        autoSchedule: false,
        captureInscricoes: false,
        captureGrupos: false,
        captureResultados: false,
        fetchEliminatoria: false,
        reason: "unknown",
      };
  }
}
