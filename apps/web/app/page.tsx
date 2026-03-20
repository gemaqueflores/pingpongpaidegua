"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { PublicFooter } from "../components/user/PublicFooter";
import { buildWaitlistMailto, siteContent } from "../lib/siteContent";

type EventRow = UserEventRow;
type EventTypeFilter = "ALL" | "ESTADUAL" | "COPA" | "BRASILEIRAO" | "OPEN";
type EventStatusFilter = "ALL" | "OPEN" | "DONE";
type AthleteQuickOption = {
  id: number;
  nameDisplay?: string;
  name?: string;
  club?: { name: string } | null;
};

type EventDisplayStatus =
  | "INSCRICOES_ABERTAS"
  | "INSCRICOES_ENCERRADAS"
  | "GRUPOS_DIVULGADOS"
  | "EM_DISPUTA"
  | "CONCLUIDO";

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
  const [quickAthleteQueryByEventId, setQuickAthleteQueryByEventId] = useState<Record<number, string>>({});
  const [quickAthleteLoadingByEventId, setQuickAthleteLoadingByEventId] = useState<Record<number, boolean>>({});
  const [quickAthleteOptionsByEventId, setQuickAthleteOptionsByEventId] = useState<
    Record<number, AthleteQuickOption[]>
  >({});
  const [quickAthleteSelectedByEventId, setQuickAthleteSelectedByEventId] = useState<
    Record<number, AthleteQuickOption | null>
  >({});
  const [quickAthleteTouchedByEventId, setQuickAthleteTouchedByEventId] = useState<Record<number, boolean>>({});
  const [waitlistEmail, setWaitlistEmail] = useState("");
  const quickSearchTimersRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

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
  const activeEvents = useMemo(
    () => sortedEvents.filter((event) => resolveDisplayStatus(event) !== "CONCLUIDO"),
    [sortedEvents],
  );

  useEffect(() => {
    return () => {
      for (const timer of Object.values(quickSearchTimersRef.current)) {
        clearTimeout(timer);
      }
      quickSearchTimersRef.current = {};
    };
  }, []);

  function athleteOptionLabel(athlete: AthleteQuickOption): string {
    return athlete.nameDisplay ?? athlete.name ?? `Atleta #${athlete.id}`;
  }

  function setQuickSearchState(eventId: number, nextQuery: string): void {
    setQuickAthleteQueryByEventId((current) => ({ ...current, [eventId]: nextQuery }));
    setQuickAthleteTouchedByEventId((current) => ({ ...current, [eventId]: true }));

    const selected = quickAthleteSelectedByEventId[eventId];
    if (selected && athleteOptionLabel(selected) !== nextQuery) {
      setQuickAthleteSelectedByEventId((current) => ({ ...current, [eventId]: null }));
    }

    const normalizedQuery = nextQuery.trim();
    if (quickSearchTimersRef.current[eventId]) {
      clearTimeout(quickSearchTimersRef.current[eventId]);
      delete quickSearchTimersRef.current[eventId];
    }

    if (normalizedQuery.length < 2) {
      setQuickAthleteOptionsByEventId((current) => ({ ...current, [eventId]: [] }));
      setQuickAthleteLoadingByEventId((current) => ({ ...current, [eventId]: false }));
      return;
    }

    quickSearchTimersRef.current[eventId] = setTimeout(() => {
      setQuickAthleteLoadingByEventId((current) => ({ ...current, [eventId]: true }));
      void apiGetAthletes(eventId, normalizedQuery)
        .then((rows) => {
          setQuickAthleteOptionsByEventId((current) => ({
            ...current,
            [eventId]: (rows as AthleteQuickOption[]).slice(0, 8),
          }));
        })
        .catch(() => {
          setQuickAthleteOptionsByEventId((current) => ({ ...current, [eventId]: [] }));
        })
        .finally(() => {
          setQuickAthleteLoadingByEventId((current) => ({ ...current, [eventId]: false }));
        });
    }, 220);
  }

  function openAthleteGames(eventId: number): void {
    const selected = quickAthleteSelectedByEventId[eventId];
    if (!selected) return;
    router.push(`/events/${eventId}/athletes/${selected.id}`);
  }

  function joinWaitlist(): void {
    window.location.href = buildWaitlistMailto(waitlistEmail.trim());
  }

  return (
    <UserShell>
      <div className="user-theme home-theme">
      <main className="container grid user-page">
        <Hero
          title="Plataforma de Tênis de Mesa Brasil"
          subtitle={siteContent.heroStatement}
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
              <button
                type="button"
                className="secondary"
                onClick={() => router.push("/sobre")}
                aria-label="Saiba mais sobre o projeto"
              >
                Sobre o app
              </button>
            </>
          }
        />
        <Card className="grid" variant="event">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2>Sobre o projeto</h2>
            <Badge tone="default">Projeto independente</Badge>
          </div>
          <p className="arena-muted">{siteContent.shortDescription}</p>
          <div className="institutional-grid">
            <article className="athlete-list-card compact-summary-card">
              <h3>Como funciona</h3>
              <ol className="institutional-list">
                <li>Capturamos inscrições, grupos e resultados de eventos de tênis de mesa.</li>
                <li>Processamos atletas, clubes, jogos e categorias com regras auditáveis.</li>
                <li>Publicamos consultas rápidas para atletas, clubes e acompanhamento do evento.</li>
              </ol>
            </article>
            <article className="athlete-list-card compact-summary-card">
              <h3>Principais recursos</h3>
              <ul className="institutional-list">
                <li>Consulta pública de eventos, atletas e eficiência.</li>
                <li>Resumo individual por atleta e leitura de desempenho.</li>
                <li>Simulador de grupos e acompanhamento por categoria.</li>
              </ul>
            </article>
            <article className="athlete-list-card compact-summary-card">
              <h3>Lista de espera</h3>
              <p className="compact-summary-meta">
                Receba novidades sobre novos recursos, cobertura de eventos e evoluções do app.
              </p>
              <div className="institutional-waitlist">
                <input
                  type="email"
                  value={waitlistEmail}
                  onChange={(event) => setWaitlistEmail(event.target.value)}
                  placeholder="Seu e-mail"
                  aria-label="Seu e-mail"
                />
                <button type="button" onClick={joinWaitlist}>
                  Entrar na lista
                </button>
              </div>
            </article>
          </div>
        </Card>
        {highlightedEvent ? (
          <Card className="grid" variant="event">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2>{activeEvents.length > 0 ? "Próximos eventos" : "Próximo evento"}</h2>
              <Badge tone={activeEvents.length > 0 ? "open" : eventStatusTone(resolveDisplayStatus(highlightedEvent))}>
                {activeEvents.length > 0 ? `${activeEvents.length} ativo(s)` : eventStatusLabel(resolveDisplayStatus(highlightedEvent))}
              </Badge>
            </div>
            <div className="event-card-grid">
              {(activeEvents.length > 0 ? activeEvents : [highlightedEvent]).map((event) => (
                <article key={`next-${event.id}`} className="athlete-list-card compact-summary-card">
                  <h3>{event.nome}</h3>
                  <p className="compact-summary-meta">{eventStatusLabel(resolveDisplayStatus(event))}</p>
                  <p className="compact-summary-meta">{`${formatDate(event.dataInicio)} até ${formatDate(event.dataFim)}`}</p>
                  <div className="row next-event-actions">
                    <button type="button" onClick={() => router.push(`/events/${event.id}`)}>
                      Ver Evento
                    </button>
                    {resolveDisplayStatus(event) !== "CONCLUIDO" ? (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => router.push(`/events/${event.id}/group-simulator`)}
                        disabled={event.groupsDefined}
                      >
                        {event.groupsDefined ? "Grupos definidos" : "Simular Grupos"}
                      </button>
                    ) : null}
                  </div>
                  <div className="next-event-athlete-quick">
                    <label htmlFor={`next-event-athlete-input-${event.id}`} className="next-event-athlete-label">
                      {`Acesso rápido do atleta (${event.nome})`}
                    </label>
                    <div className="next-event-athlete-form">
                      <div className="next-event-athlete-search">
                        <input
                          id={`next-event-athlete-input-${event.id}`}
                          value={quickAthleteQueryByEventId[event.id] ?? ""}
                          onChange={(inputEvent) => {
                            setQuickSearchState(event.id, inputEvent.target.value);
                          }}
                          onFocus={() =>
                            setQuickAthleteTouchedByEventId((current) => ({ ...current, [event.id]: true }))
                          }
                          placeholder={`Digite o nome (${event.nome})`}
                          autoComplete="off"
                        />
                        {Boolean(quickAthleteTouchedByEventId[event.id]) &&
                        !quickAthleteSelectedByEventId[event.id] &&
                        (quickAthleteQueryByEventId[event.id] ?? "").trim().length >= 2 ? (
                          <div className="next-event-athlete-suggestions">
                            {quickAthleteLoadingByEventId[event.id] ? (
                              <p className="next-event-athlete-feedback">Buscando atletas...</p>
                            ) : (quickAthleteOptionsByEventId[event.id] ?? []).length === 0 ? (
                              <p className="next-event-athlete-feedback">Nenhum atleta encontrado.</p>
                            ) : (
                              <ul>
                                {(quickAthleteOptionsByEventId[event.id] ?? []).map((athlete) => (
                                  <li key={`${event.id}-${athlete.id}`}>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setQuickAthleteSelectedByEventId((current) => ({
                                          ...current,
                                          [event.id]: athlete,
                                        }));
                                        setQuickAthleteQueryByEventId((current) => ({
                                          ...current,
                                          [event.id]: athleteOptionLabel(athlete),
                                        }));
                                        setQuickAthleteOptionsByEventId((current) => ({
                                          ...current,
                                          [event.id]: [],
                                        }));
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
                        onClick={() => openAthleteGames(event.id)}
                        disabled={!quickAthleteSelectedByEventId[event.id]}
                      >
                        Ver meus jogos
                      </button>
                    </div>
                  </div>
                </article>
              ))}
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

          {!loadingEvents && filteredEvents.length === 0 ? (
            <EmptyState
              title="Nenhum evento encontrado"
              description="Ajuste os filtros para visualizar eventos nesta seção."
            />
          ) : null}
        </Card>

        <PublicFooter />
      </main>
      </div>
    </UserShell>
  );
}


