import React from "react";
import { Badge } from "./Badge";
import { designTokens } from "../../lib/designTokens";

type EventCardProps = {
  cbtmEventId: number;
  name: string;
  statusLabel: string;
  statusTone: "open" | "closed" | "done";
  periodLabel: string;
  totalInscritos: number;
  totalCategorias: number;
  groupSimulationEligible: boolean;
  groupsDefined: boolean;
  onOpen: () => void;
  onSimulate: () => void;
};

export function EventCard(props: EventCardProps) {
  const {
    cbtmEventId,
    name,
    statusLabel,
    statusTone,
    periodLabel,
    totalInscritos,
    totalCategorias,
    groupSimulationEligible,
    groupsDefined,
    onOpen,
    onSimulate,
  } = props;

  return (
    <article
      className="event-card"
      aria-label={`Evento ${name}`}
      style={{ borderRadius: designTokens.radius.component, padding: designTokens.spacing.sm }}
    >
      <div className="event-card-head">
        <div>
          <p className="event-id">Evento CBTM #{cbtmEventId}</p>
          <h3>{name}</h3>
        </div>
        <Badge tone={statusTone}>{statusLabel}</Badge>
      </div>
      <p className="event-period">{periodLabel}</p>
      <div className="event-metrics">
        <span>Inscritos: <strong>{totalInscritos}</strong></span>
        <span>Categorias: <strong>{totalCategorias}</strong></span>
      </div>
      <div className="event-actions">
        <button type="button" onClick={onOpen}>Ver Evento</button>
        <button
          type="button"
          className="secondary"
          onClick={onSimulate}
          disabled={groupsDefined || !groupSimulationEligible}
        >
          {groupsDefined ? "Grupos definidos" : "Simular Grupos"}
        </button>
      </div>
    </article>
  );
}


