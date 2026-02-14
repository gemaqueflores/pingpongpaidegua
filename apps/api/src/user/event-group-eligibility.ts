import { EventSituation } from "@cbtm/shared";

export type UserEventStatus = "INSCRICOES_ABERTAS" | "INSCRICOES_ENCERRADAS" | "CONCLUIDO";

const GROUP_SIMULATION_ELIGIBLE_SITUATIONS = new Set<EventSituation>([
  "INSCRICOES_ABERTAS",
  "POS_INSCRICOES_PRE_EVENTO",
  "PRE_INSCRICOES",
]);

export function hasGroupStructureFromMatch(input: { phase: string | null; round: string | null }): boolean {
  const phase = (input.phase ?? "").toString().trim().toUpperCase();
  const round = (input.round ?? "").toString().trim().toLowerCase();
  if (phase === "GRUPOS") {
    return true;
  }
  return round.includes("grupo");
}

export function resolveUserEventStatus(input: {
  concluido: boolean;
  eventSituation: EventSituation;
}): UserEventStatus {
  if (input.concluido) {
    return "CONCLUIDO";
  }
  if (input.eventSituation === "INSCRICOES_ABERTAS") {
    return "INSCRICOES_ABERTAS";
  }
  return "INSCRICOES_ENCERRADAS";
}

export function canUseGroupSimulation(input: {
  concluido: boolean;
  groupsDefined: boolean;
  eventSituation: EventSituation;
}): boolean {
  if (input.concluido) {
    return false;
  }
  if (input.groupsDefined) {
    return false;
  }
  return GROUP_SIMULATION_ELIGIBLE_SITUATIONS.has(input.eventSituation);
}

