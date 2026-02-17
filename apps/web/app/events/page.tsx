"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGetEvents, type UserEventRow } from "../../lib/user-api";
import { Card } from "../../components/ui/Card";
import { PageHeader } from "../../components/ui/PageHeader";
import { EventCard } from "../../components/ui/EventCard";
import { Skeleton } from "../../components/ui/Skeleton";
import { UserShell } from "../../components/user/UserShell";

type EventRow = UserEventRow;

function formatDate(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("pt-BR");
}

function eventStatusLabel(status: EventRow["userStatus"]): string {
  if (status === "INSCRICOES_ABERTAS") return "Inscrições abertas";
  if (status === "INSCRICOES_ENCERRADAS") return "Inscrições encerradas";
  return "Concluído";
}

function eventStatusTone(status: EventRow["userStatus"]): "open" | "closed" | "done" {
  if (status === "INSCRICOES_ABERTAS") return "open";
  if (status === "INSCRICOES_ENCERRADAS") return "closed";
  return "done";
}

function sortEventsByStatusAndDate(rows: EventRow[]): EventRow[] {
  return [...rows].sort((left, right) => {
    const leftOpen = left.userStatus !== "CONCLUIDO";
    const rightOpen = right.userStatus !== "CONCLUIDO";
    if (leftOpen !== rightOpen) return leftOpen ? -1 : 1;

    const leftDate = left.dataInicio ? new Date(left.dataInicio).getTime() : Number.MAX_SAFE_INTEGER;
    const rightDate = right.dataInicio ? new Date(right.dataInicio).getTime() : Number.MAX_SAFE_INTEGER;
    if (leftOpen && rightOpen) return leftDate - rightDate;
    return rightDate - leftDate;
  });
}

export default function EventsHubPage() {
  const router = useRouter();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void apiGetEvents()
      .then((rows) => setEvents(rows as EventRow[]))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, []);

  const sortedEvents = useMemo(() => sortEventsByStatusAndDate(events), [events]);

  return (
    <UserShell>
      <main className="container grid user-page">
        <PageHeader title="Eventos" subtitle="Calendário e acompanhamento" compact className="events-page-header" />

        <Card className="grid" variant="event">
          {loading ? (
            <div className="event-card-grid">
              <Skeleton className="event-skeleton" height="146px" />
              <Skeleton className="event-skeleton" height="146px" />
              <Skeleton className="event-skeleton" height="146px" />
            </div>
          ) : (
            <div className="event-card-grid events-page-grid">
              {sortedEvents.map((event) => (
                <EventCard
                  key={event.id}
                  cbtmEventId={event.cbtmEventId}
                  name={event.nome}
                  statusLabel={eventStatusLabel(event.userStatus)}
                  statusTone={eventStatusTone(event.userStatus)}
                  periodLabel={`${formatDate(event.dataInicio)} até ${formatDate(event.dataFim)}`}
                  totalInscritos={event.totalInscritos}
                  totalCategorias={event.totalCategorias}
                  groupSimulationEligible={event.groupSimulationEligible}
                  groupsDefined={event.groupsDefined}
                  onOpen={() => router.push(`/events/${event.id}`)}
                  onSimulate={() => router.push(`/events/${event.id}/group-simulator`)}
                />
              ))}
            </div>
          )}
        </Card>
      </main>
    </UserShell>
  );
}

