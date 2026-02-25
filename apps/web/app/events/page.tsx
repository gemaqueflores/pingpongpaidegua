"use client";

import { useEffect, useMemo, useState } from "react";
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

type EventRow = UserEventRow;
type EventDisplayStatus =
  | "INSCRICOES_ABERTAS"
  | "INSCRICOES_ENCERRADAS"
  | "GRUPOS_DIVULGADOS"
  | "EM_DISPUTA"
  | "CONCLUIDO";
type EventTypeFilter = "ALL" | "ESTADUAL" | "COPA" | "BRASILEIRAO" | "OPEN";
type EventStatusFilter = "ALL" | "OPEN" | "DONE";

function formatDate(value: string | null): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Belem",
  }).format(new Date(value));
}

function toTs(value: string | null): number | null {
  if (!value) return null;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : null;
}

function resolveDisplayStatus(event: EventRow): EventDisplayStatus {
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

function eventStatusLabel(status: EventDisplayStatus): string {
  if (status === "INSCRICOES_ABERTAS") return "Inscrições abertas";
  if (status === "INSCRICOES_ENCERRADAS") return "Inscrições encerradas";
  if (status === "GRUPOS_DIVULGADOS") return "Grupos divulgados";
  if (status === "EM_DISPUTA") return "Em disputa";
  return "Concluído";
}

function eventStatusTone(status: EventDisplayStatus): "open" | "closed" | "done" {
  if (status === "INSCRICOES_ABERTAS" || status === "EM_DISPUTA") return "open";
  if (status === "INSCRICOES_ENCERRADAS") return "closed";
  if (status === "GRUPOS_DIVULGADOS") return "closed";
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

function inferEventType(event: EventRow): Exclude<EventTypeFilter, "ALL"> {
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

export default function EventsHubPage() {
  const router = useRouter();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [eventTypeFilter, setEventTypeFilter] = useState<EventTypeFilter>("ALL");
  const [eventStatusFilter, setEventStatusFilter] = useState<EventStatusFilter>("ALL");
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);

  useEffect(() => {
    void apiGetEvents()
      .then((rows) => setEvents(rows as EventRow[]))
      .catch(() => setEvents([]))
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
          {!loading && filteredEvents.length === 0 ? (
            <EmptyState title="Sem resultados" description="Nenhum evento atende aos filtros selecionados." />
          ) : null}
        </Card>
      </main>
    </UserShell>
  );
}

