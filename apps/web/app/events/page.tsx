"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGetEvents, type UserEventRow } from "../../lib/user-api";
import { Card } from "../../components/ui/Card";
import { PageHeader } from "../../components/ui/PageHeader";
import { EventCard } from "../../components/ui/EventCard";
import { Skeleton } from "../../components/ui/Skeleton";
import { UserShell } from "../../components/user/UserShell";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { FilterDrawer } from "../../components/ui/FilterDrawer";
import { EmptyState } from "../../components/ui/EmptyState";
import {
  eventStatusLabel,
  eventStatusTone,
  formatDate,
  inferEventType,
  resolveDisplayStatus,
  sortEventsByStatusAndDate,
  type EventStatusFilter,
  type EventTypeFilter,
} from "../../lib/event-utils";

type EventRow = UserEventRow;

export default function EventsHubPage() {
  const router = useRouter();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState(false);
  const [eventTypeFilter, setEventTypeFilter] = useState<EventTypeFilter>("ALL");
  const [eventStatusFilter, setEventStatusFilter] = useState<EventStatusFilter>("ALL");
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);

  useEffect(() => {
    void apiGetEvents()
      .then((rows) => {
        setApiError(false);
        setEvents(rows as EventRow[]);
      })
      .catch(() => {
        setApiError(true);
        setEvents([]);
      })
      .finally(() => setLoading(false));
  }, []);

  const sortedEvents = useMemo(() => sortEventsByStatusAndDate(events), [events]);
  const filteredEvents = useMemo(() => {
    return sortedEvents.filter((event) => {
      const type = inferEventType(event);
      const status = event.userStatus === "CONCLUIDO" ? "DONE" : "OPEN";
      if (eventTypeFilter !== "ALL" && eventTypeFilter !== type) return false;
      if (eventStatusFilter !== "ALL" && eventStatusFilter !== status) return false;
      return true;
    });
  }, [eventStatusFilter, eventTypeFilter, sortedEvents]);

  return (
    <UserShell>
      <main className="container grid user-page">
        <PageHeader title="Eventos" subtitle="Calendário e acompanhamento" compact className="events-page-header" />

        <Card className="grid" variant="event">
          <FilterDrawer title="eventos" open={mobileFilterOpen} onToggle={() => setMobileFilterOpen((prev) => !prev)}>
            <SegmentedControl
              label="Tipo do evento"
              value={eventTypeFilter}
              onChange={setEventTypeFilter}
              items={[
                { value: "ALL", label: "Todos os tipos" },
                { value: "ESTADUAL", label: "Estadual" },
                { value: "COPA", label: "Copa" },
                { value: "BRASILEIRAO", label: "Brasileirão" },
                { value: "OPEN", label: "Open" },
              ]}
            />
            <SegmentedControl
              label="Status do evento"
              value={eventStatusFilter}
              onChange={setEventStatusFilter}
              items={[
                { value: "ALL", label: "Todos os status" },
                { value: "OPEN", label: "Em aberto" },
                { value: "DONE", label: "Concluídos" },
              ]}
            />
          </FilterDrawer>

          {loading ? (
            <div className="event-card-grid">
              <Skeleton className="event-skeleton" height="146px" />
              <Skeleton className="event-skeleton" height="146px" />
              <Skeleton className="event-skeleton" height="146px" />
            </div>
          ) : (
            <div className="event-card-grid events-page-grid">
              {filteredEvents.map((event) => (
                <EventCard
                  key={event.id}
                  cbtmEventId={event.cbtmEventId}
                  name={event.nome}
                  statusLabel={eventStatusLabel(resolveDisplayStatus(event))}
                  statusTone={eventStatusTone(resolveDisplayStatus(event))}
                  periodLabel={`${formatDate(event.dataInicio)} até ${formatDate(event.dataFim)}`}
                  totalInscritos={event.totalInscritos}
                  inscricoesTotaisOficiais={event.inscricoesTotaisOficiais}
                  totalPartidas={event.totalPartidas}
                  totalPartidasJogadas={event.totalPartidasJogadas}
                  totalCategorias={event.totalCategorias}
                  groupsDefined={event.groupsDefined}
                  isConcluded={event.userStatus === "CONCLUIDO"}
                  onOpen={() => router.push(`/events/${event.id}`)}
                  onSimulate={() => router.push(`/events/${event.id}/group-simulator`)}
                />
              ))}
            </div>
          )}
          <EventsHubEmptyState loading={loading} apiError={apiError} filteredCount={filteredEvents.length} />
        </Card>
      </main>
    </UserShell>
  );
}

function EventsHubEmptyState({
  loading,
  apiError,
  filteredCount,
}: {
  loading: boolean;
  apiError: boolean;
  filteredCount: number;
}) {
  if (loading) return null;
  if (apiError) {
    return (
      <EmptyState
        title="Serviço indisponível"
        description="Não foi possível carregar os eventos. Tente novamente em instantes."
      />
    );
  }
  if (filteredCount === 0) {
    return <EmptyState title="Sem resultados" description="Nenhum evento atende aos filtros selecionados." />;
  }
  return null;
}
