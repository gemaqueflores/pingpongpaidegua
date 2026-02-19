"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  apiGetAthletes,
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
import { UserShell } from "../components/user/UserShell";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { FilterDrawer } from "../components/ui/FilterDrawer";
import { EmptyState } from "../components/ui/EmptyState";

type EventRow = UserEventRow;
type EventTypeFilter = "ALL" | "ESTADUAL" | "COPA" | "BRASILEIRAO" | "OPEN";
type EventStatusFilter = "ALL" | "OPEN" | "DONE";
type AthleteQuickOption = {
  id: number;
  nameDisplay?: string;
  name?: string;
  club?: { name: string } | null;
};

type EventDisplayStatus = "INSCRICOES_ABERTAS" | "INSCRICOES_ENCERRADAS" | "EM_DISPUTA" | "CONCLUIDO";

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
  const [quickAthleteQuery, setQuickAthleteQuery] = useState("");
  const [quickAthleteLoading, setQuickAthleteLoading] = useState(false);
  const [quickAthleteOptions, setQuickAthleteOptions] = useState<AthleteQuickOption[]>([]);
  const [quickAthleteSelected, setQuickAthleteSelected] = useState<AthleteQuickOption | null>(null);
  const [quickAthleteTouched, setQuickAthleteTouched] = useState(false);

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

  useEffect(() => {
    setQuickAthleteQuery("");
    setQuickAthleteLoading(false);
    setQuickAthleteOptions([]);
    setQuickAthleteSelected(null);
    setQuickAthleteTouched(false);
  }, [highlightedEvent?.id]);

  useEffect(() => {
    if (!highlightedEvent) {
      setQuickAthleteOptions([]);
      setQuickAthleteLoading(false);
      return;
    }

    const search = quickAthleteQuery.trim();
    if (search.length < 2) {
      setQuickAthleteOptions([]);
      setQuickAthleteLoading(false);
      return;
    }

    const timeout = setTimeout(() => {
      setQuickAthleteLoading(true);
      void apiGetAthletes(highlightedEvent.id, search)
        .then((rows) => {
          setQuickAthleteOptions((rows as AthleteQuickOption[]).slice(0, 8));
        })
        .catch(() => {
          setQuickAthleteOptions([]);
        })
        .finally(() => setQuickAthleteLoading(false));
    }, 220);

    return () => clearTimeout(timeout);
  }, [highlightedEvent, quickAthleteQuery]);

  function athleteOptionLabel(athlete: AthleteQuickOption): string {
    return athlete.nameDisplay ?? athlete.name ?? `Atleta #${athlete.id}`;
  }

  function openAthleteGames() {
    if (!highlightedEvent || !quickAthleteSelected) return;
    router.push(`/events/${highlightedEvent.id}/athletes/${quickAthleteSelected.id}`);
  }

  return (
    <UserShell>
      <div className="user-theme home-theme">
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
            <div className="next-event-athlete-quick">
              <label htmlFor="next-event-athlete-input" className="next-event-athlete-label">
                Acesso rápido do atleta
              </label>
              <div className="next-event-athlete-form">
                <div className="next-event-athlete-search">
                  <input
                    id="next-event-athlete-input"
                    value={quickAthleteQuery}
                    onChange={(event) => {
                      setQuickAthleteQuery(event.target.value);
                      setQuickAthleteTouched(true);
                      if (quickAthleteSelected && athleteOptionLabel(quickAthleteSelected) !== event.target.value) {
                        setQuickAthleteSelected(null);
                      }
                    }}
                    onFocus={() => setQuickAthleteTouched(true)}
                    placeholder="Digite o nome do atleta"
                    autoComplete="off"
                  />
                  {quickAthleteTouched && !quickAthleteSelected && quickAthleteQuery.trim().length >= 2 ? (
                    <div className="next-event-athlete-suggestions">
                      {quickAthleteLoading ? (
                        <p className="next-event-athlete-feedback">Buscando atletas...</p>
                      ) : quickAthleteOptions.length === 0 ? (
                        <p className="next-event-athlete-feedback">Nenhum atleta encontrado.</p>
                      ) : (
                        <ul>
                          {quickAthleteOptions.map((athlete) => (
                            <li key={athlete.id}>
                              <button
                                type="button"
                                onClick={() => {
                                  setQuickAthleteSelected(athlete);
                                  setQuickAthleteQuery(athleteOptionLabel(athlete));
                                  setQuickAthleteOptions([]);
                                }}
                              >
                                <span>{athleteOptionLabel(athlete)}</span>
                                {athlete.club?.name ? <small>{athlete.club.name}</small> : null}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="secondary"
                  onClick={openAthleteGames}
                  disabled={!quickAthleteSelected}
                >
                  Ver meus jogos
                </button>
              </div>
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
            <FilterDrawer
              title="eventos"
              open={mobileEventFiltersOpen}
              onToggle={() => setMobileEventFiltersOpen((current) => !current)}
            >
              <SegmentedControl
                label="Filtro por tipo"
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
                label="Filtro por status"
                value={eventStatusFilter}
                onChange={setEventStatusFilter}
                items={[
                  { value: "ALL", label: "Todos os status" },
                  { value: "OPEN", label: "Em aberto" },
                  { value: "DONE", label: "Concluídos" },
                ]}
              />
            </FilterDrawer>
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
            <EmptyState
              title="Nenhum evento encontrado"
              description="Ajuste os filtros para visualizar eventos nesta seção."
            />
          ) : null}
        </Card>

        <footer className="arena-footer">
          <p>PingPong Paid'egua © {new Date().getFullYear()} - Plataforma de Tênis de Mesa Brasil</p>
        </footer>
      </main>
      </div>
    </UserShell>
  );
}


