import type { UserEventRow } from "./user-api";

export type EventDisplayStatus =
  | "INSCRICOES_ABERTAS"
  | "INSCRICOES_ENCERRADAS"
  | "GRUPOS_DIVULGADOS"
  | "EM_DISPUTA"
  | "CONCLUIDO";

export type EventTypeFilter = "ALL" | "ESTADUAL" | "COPA" | "BRASILEIRAO" | "OPEN";
export type EventStatusFilter = "ALL" | "OPEN" | "DONE";

type EventRow = UserEventRow;

export function formatDate(value: string | null): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Belem",
  }).format(new Date(value));
}

export function toTs(value: string | null): number | null {
  if (!value) return null;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : null;
}

export function resolveDisplayStatus(event: EventRow): EventDisplayStatus {
  if (event.concluido || event.userStatus === "CONCLUIDO") {
    return "CONCLUIDO";
  }

  if (
    event.situacaoComputada === "GRADES_PUBLICADAS_PRE_JOGO" ||
    (event.situacaoComputada === "POS_INSCRICOES_PRE_EVENTO" && event.groupsDefined)
  ) {
    return "GRUPOS_DIVULGADOS";
  }

  const now = Date.now();
  const inicioRealizacao = toTs(event.inicioRealizacao ?? event.dataInicio);
  const fimRealizacao = toTs(event.fimRealizacao ?? event.dataFim);
  if (inicioRealizacao !== null && fimRealizacao !== null && now >= inicioRealizacao && now <= fimRealizacao) {
    return "EM_DISPUTA";
  }

  const fimInscricoes = toTs(event.fimInscricoes);
  if (fimInscricoes !== null && now > fimInscricoes) {
    return "INSCRICOES_ENCERRADAS";
  }

  return "INSCRICOES_ABERTAS";
}

export function eventStatusLabel(status: EventDisplayStatus): string {
  if (status === "INSCRICOES_ABERTAS") return "Inscrições abertas";
  if (status === "INSCRICOES_ENCERRADAS") return "Inscrições encerradas";
  if (status === "GRUPOS_DIVULGADOS") return "Grupos divulgados";
  if (status === "EM_DISPUTA") return "Em disputa";
  return "Concluído";
}

export function eventStatusTone(status: EventDisplayStatus): "open" | "closed" | "done" {
  if (status === "INSCRICOES_ABERTAS" || status === "EM_DISPUTA") return "open";
  if (status === "INSCRICOES_ENCERRADAS") return "closed";
  if (status === "GRUPOS_DIVULGADOS") return "closed";
  return "done";
}

export function sortEventsByStatusAndDate(rows: EventRow[]): EventRow[] {
  return [...rows].sort((left, right) => {
    const leftOpen = left.userStatus !== "CONCLUIDO";
    const rightOpen = right.userStatus !== "CONCLUIDO";

    if (leftOpen !== rightOpen) return leftOpen ? -1 : 1;

    const leftDate = left.dataInicio ? new Date(left.dataInicio).getTime() : Number.MAX_SAFE_INTEGER;
    const rightDate = right.dataInicio ? new Date(right.dataInicio).getTime() : Number.MAX_SAFE_INTEGER;

    if (leftOpen && rightOpen) {
      if (leftDate !== rightDate) return leftDate - rightDate;
    } else if (leftDate !== rightDate) {
      return rightDate - leftDate;
    }

    return left.nome.localeCompare(right.nome, "pt-BR", { sensitivity: "base" });
  });
}

export function inferEventType(event: EventRow): Exclude<EventTypeFilter, "ALL"> {
  if (event.nivel === "OPEN") return "OPEN";
  if (event.nivel === "ESTADUAL") return "ESTADUAL";
  if (event.nivel === "COPA") return "COPA";
  if (event.nivel === "NACIONAL") return "BRASILEIRAO";

  const normalized = event.nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
  if (normalized.includes("OPEN")) return "OPEN";
  if (normalized.includes("COPA")) return "COPA";
  if (normalized.includes("BRASILEIR") || normalized.includes("NACIONAL")) return "BRASILEIRAO";
  return "ESTADUAL";
}
