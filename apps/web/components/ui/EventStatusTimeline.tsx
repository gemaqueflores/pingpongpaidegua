"use client";

type EventPhase = "INSCRICOES_ABERTAS" | "INSCRICOES_ENCERRADAS" | "EM_DISPUTA" | "CONCLUIDO";

const PHASES: Array<{ id: EventPhase; label: string }> = [
  { id: "INSCRICOES_ABERTAS", label: "Inscrições abertas" },
  { id: "INSCRICOES_ENCERRADAS", label: "Inscrições encerradas" },
  { id: "EM_DISPUTA", label: "Em disputa" },
  { id: "CONCLUIDO", label: "Concluído" },
];

export function EventStatusTimeline({ phase }: { phase: EventPhase }) {
  const activeIndex = PHASES.findIndex((step) => step.id === phase);

  return (
    <div className="event-status-timeline" role="list" aria-label="Linha do tempo do evento">
      {PHASES.map((step, index) => {
        const isDone = index <= activeIndex;
        const isCurrent = index === activeIndex;
        return (
          <div
            key={step.id}
            role="listitem"
            className={`event-status-step ${isDone ? "done" : ""} ${isCurrent ? "current" : ""}`}
            aria-current={isCurrent ? "step" : undefined}
          >
            <span className="event-status-dot" aria-hidden="true" />
            <span className="event-status-label">{step.label}</span>
          </div>
        );
      })}
    </div>
  );
}
