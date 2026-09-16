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
  inscricoesTotaisOficiais?: number;
  totalPartidas?: number;
  totalPartidasJogadas?: number;
  totalCategorias: number;
  groupsDefined: boolean;
  isConcluded: boolean;
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
    inscricoesTotaisOficiais,
    totalPartidas,
    totalPartidasJogadas,
    totalCategorias,
    groupsDefined,
    isConcluded,
    onOpen,
    onSimulate,
  } = props;

  const groupStateDisabled = groupsDefined;
  const groupStateLabel = groupsDefined
      ? "Grupos definidos"
      : "Simular Grupos";

  return (
    <article
      className="event-card"
      aria-label={`Evento ${name}`}
      style={{ borderRadius: designTokens.radius.component, padding: designTokens.spacing.sm }}
    >
      <div className="event-card-head">
        <div>
          <p className="event-id">CBTM #{cbtmEventId}</p>
          <h3>{name}</h3>
        </div>
        <Badge tone={statusTone}>{statusLabel}</Badge>
      </div>
      <p className="event-period">{periodLabel}</p>
      <div className="event-card-metrics">
        <span>Atletas: <strong>{totalInscritos}</strong></span>
        <span>Inscrições: <strong>{inscricoesTotaisOficiais ?? totalInscritos}</strong></span>
        <span>Partidas: <strong>{totalPartidasJogadas ?? totalPartidas ?? 0}</strong></span>
        <span>Categorias: <strong>{totalCategorias}</strong></span>
      </div>
      <div className={`event-actions ${isConcluded ? "event-actions-single" : ""}`}>
        <button type="button" onClick={onOpen}>Ver Evento</button>
        {!isConcluded ? (
          <button
            type="button"
            className="secondary"
            onClick={onSimulate}
            disabled={groupStateDisabled}
          >
            {groupStateLabel}
          </button>
        ) : null}
      </div>
    </article>
  );
}


