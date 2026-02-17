"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  apiGetAthletesDirectory,
  apiGetGlobalEfficiency,
  apiGetEvents,
  type GlobalEfficiencyResponse,
  type UserEventRow,
} from "../lib/user-api";
import { Hero } from "../components/ui/Hero";
import { Card } from "../components/ui/Card";
import { EventCard } from "../components/ui/EventCard";
import { Skeleton } from "../components/ui/Skeleton";
import { Badge } from "../components/ui/Badge";
import { UserHeader } from "../components/user/UserHeader";

type EventRow = UserEventRow;
type EventTypeFilter = "ALL" | "ESTADUAL" | "COPA" | "BRASILEIRAO" | "OPEN";
type EventStatusFilter = "ALL" | "OPEN" | "DONE";

type EventDisplayStatus = "INSCRICOES_ABERTAS" | "INSCRICOES_ENCERRADAS" | "EM_DISPUTA" | "CONCLUIDO";

function formatDate(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("pt-BR");
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
  if (status === "EM_DISPUTA") return "Em disputa";
  return "Concluído";
}

function eventStatusTone(status: EventDisplayStatus): "open" | "closed" | "done" {
  if (status === "INSCRICOES_ABERTAS" || status === "EM_DISPUTA") return "open";
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

    if (leftOpen && rightOpen) {
      if (leftDate !== rightDate) return leftDate - rightDate;
    } else if (leftDate !== rightDate) {
      return rightDate - leftDate;
    }

    return left.nome.localeCompare(right.nome, "pt-BR", { sensitivity: "base" });
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

export default function HomePage() {
  const router = useRouter();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [loadingAthletes, setLoadingAthletes] = useState(true);
  const [loadingClubs, setLoadingClubs] = useState(true);
  const [athleteTotal, setAthleteTotal] = useState(0);
  const [globalEfficiency, setGlobalEfficiency] = useState<GlobalEfficiencyResponse | null>(null);
  const [eventTypeFilter, setEventTypeFilter] = useState<EventTypeFilter>("ALL");
  const [eventStatusFilter, setEventStatusFilter] = useState<EventStatusFilter>("ALL");
  const [mobileEventFiltersOpen, setMobileEventFiltersOpen] = useState(false);

  useEffect(() => {
    void apiGetEvents()
      .then((rows) => setEvents(rows as EventRow[]))
      .catch(() => setEvents([]))
      .finally(() => setLoadingEvents(false));

    void apiGetAthletesDirectory()
      .then((rows) => setAthleteTotal(rows.length))
      .catch(() => setAthleteTotal(0))
      .finally(() => setLoadingAthletes(false));

    void apiGetGlobalEfficiency()
      .then((result) => setGlobalEfficiency(result))
      .catch(() => setGlobalEfficiency(null))
      .finally(() => setLoadingClubs(false));
  }, []);

  const sortedEvents = useMemo(() => sortEventsByStatusAndDate(events), [events]);
  const highlightedEvent = useMemo(
    () =>
      sortedEvents.find((event) => event.userStatus !== "CONCLUIDO") ??
      sortedEvents.find((event) => event.userStatus === "CONCLUIDO") ??
      null,
    [sortedEvents],
  );

  const filteredEvents = useMemo(() => {
    return sortedEvents.filter((event) => {
      const type = inferEventType(event);
      const status = event.userStatus === "CONCLUIDO" ? "DONE" : "OPEN";
      if (eventTypeFilter !== "ALL" && type !== eventTypeFilter) return false;
      if (eventStatusFilter !== "ALL" && status !== eventStatusFilter) return false;
      return true;
    });
  }, [eventStatusFilter, eventTypeFilter, sortedEvents]);

  return (
    <div className="user-theme home-theme">
      <UserHeader />
      <main className="container grid user-page">
        <Hero
          title="Plataforma de Tênis de Mesa Brasil"
          subtitle="PingPong Paid'egua"
          className="home-page-hero"
          actions={
            <>
              <button
                type="button"
                onClick={() => router.push("/reporte")}
                aria-label="Reportar problema"
              >
                Reportar problema
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => router.push("/apoie")}
                aria-label="Apoiar o projeto"
              >
                Apoie o projeto
              </button>
            </>
          }
        />
        {highlightedEvent ? (
          <Card className="grid" variant="event">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2>Próximo evento</h2>
              <Badge tone={eventStatusTone(resolveDisplayStatus(highlightedEvent))}>
                {eventStatusLabel(resolveDisplayStatus(highlightedEvent))}
              </Badge>
            </div>
            <p>
              <strong>{highlightedEvent.nome}</strong> •{" "}
              {`${formatDate(highlightedEvent.dataInicio)} até ${formatDate(highlightedEvent.dataFim)}`}
            </p>
            <div className="row next-event-actions">
              <button type="button" onClick={() => router.push(`/events/${highlightedEvent.id}`)}>
                Ver Evento
              </button>
              {resolveDisplayStatus(highlightedEvent) !== "CONCLUIDO" ? (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => router.push(`/events/${highlightedEvent.id}/group-simulator`)}
                  disabled={highlightedEvent.groupsDefined}
                >
                  {highlightedEvent.groupsDefined ? "Grupos definidos" : "Simular Grupos"}
                </button>
              ) : null}
            </div>
          </Card>
        ) : null}

        <Card className="grid" variant="event">
          <h2>Nossos Atletas e Clubes</h2>
          {(loadingAthletes || loadingClubs) ? (
            <div className="event-card-grid">
              <Skeleton className="event-skeleton" height="120px" />
              <Skeleton className="event-skeleton" height="120px" />
            </div>
          ) : (
            <div className="event-card-grid">
              <article className="athlete-list-card compact-summary-card">
                <h3>Atletas</h3>
                <p className="compact-summary-total">{athleteTotal}</p>
                <p className="compact-summary-meta">Atletas cadastrados</p>
                <button onClick={() => router.push("/atletas")}>Ver Atletas</button>
              </article>
              <article className="athlete-list-card compact-summary-card">
                <h3>Eficiência</h3>
                <p className="compact-summary-total">{globalEfficiency?.ranking.length ?? 0}</p>
                <p className="compact-summary-meta">Clubes participantes</p>
                <button onClick={() => router.push("/eficiencia")}>Ver Eficiência</button>
              </article>
            </div>
          )}
        </Card>

        <Card id="eventos-em-destaque" className="grid" variant="event">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2>Eventos na base</h2>
            <Badge tone="default">Ordenado por situação e data</Badge>
          </div>
          <div className="row home-event-filters">
            <button
              type="button"
              className="events-filter-trigger"
              onClick={() => setMobileEventFiltersOpen((current) => !current)}
              aria-expanded={mobileEventFiltersOpen}
              aria-controls="event-filters-panel"
            >
              Filtrar eventos
            </button>
            <div
              id="event-filters-panel"
              className={`home-event-filters-panel ${mobileEventFiltersOpen ? "open" : ""}`}
            >
              <div className="balloon-group" role="group" aria-label="Filtro por tipo">
                {(["ALL", "ESTADUAL", "COPA", "BRASILEIRAO", "OPEN"] as EventTypeFilter[]).map((type) => (
                  <button
                    key={type}
                    type="button"
                    className={`balloon-button ${eventTypeFilter === type ? "active" : ""}`}
                    onClick={() => setEventTypeFilter(type)}
                  >
                    {type === "ALL" ? "Todos os tipos" : type === "BRASILEIRAO" ? "Brasileirão" : type}
                  </button>
                ))}
              </div>
              <div className="balloon-group" role="group" aria-label="Filtro por status">
                {(["ALL", "OPEN", "DONE"] as EventStatusFilter[]).map((status) => (
                  <button
                    key={status}
                    type="button"
                    className={`balloon-button ${eventStatusFilter === status ? "active" : ""}`}
                    onClick={() => setEventStatusFilter(status)}
                  >
                    {status === "ALL" ? "Todos os status" : status === "OPEN" ? "Em aberto" : "Concluídos"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {loadingEvents ? (
            <div className="event-card-grid">
              <Skeleton className="event-skeleton" height="146px" />
              <Skeleton className="event-skeleton" height="146px" />
              <Skeleton className="event-skeleton" height="146px" />
            </div>
          ) : (
            <div className="event-card-grid">
              {filteredEvents.map((event) => (
                <EventCard
                  key={event.id}
                  cbtmEventId={event.cbtmEventId}
                  name={event.nome}
                  statusLabel={eventStatusLabel(resolveDisplayStatus(event))}
                  statusTone={eventStatusTone(resolveDisplayStatus(event))}
                  periodLabel={`${formatDate(event.dataInicio)} até ${formatDate(event.dataFim)}`}
                  totalInscritos={event.totalInscritos}
                  totalCategorias={event.totalCategorias}
                  groupsDefined={event.groupsDefined}
                  isConcluded={event.userStatus === "CONCLUIDO"}
                  onOpen={() => router.push(`/events/${event.id}`)}
                  onSimulate={() => router.push(`/events/${event.id}/group-simulator`)}
                />
              ))}
            </div>
          )}

          {!loadingEvents && filteredEvents.length === 0 ? (
            <p className="arena-muted">Nenhum evento encontrado.</p>
          ) : null}
        </Card>

        <footer className="arena-footer">
          <p>PingPong Paid'egua © {new Date().getFullYear()} - Plataforma de Tênis de Mesa Brasil</p>
        </footer>
      </main>
    </div>
  );
}


