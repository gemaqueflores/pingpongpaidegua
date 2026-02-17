"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

type AthleteDirectoryRow = {
  athleteKey: string;
  nameDisplay: string;
  nameReduced: string;
  firstLetter: string;
  totalEvents: number;
  totalAthleteRecords: number;
};

function formatDate(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("pt-BR");
}

function eventStatusLabel(status: EventRow["userStatus"]): string {
  if (status === "INSCRICOES_ABERTAS") return "Inscricoes abertas";
  if (status === "INSCRICOES_ENCERRADAS") return "Inscricoes encerradas";
  return "Concluido";
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

  const name = event.nome;
  const normalized = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
  if (normalized.includes("OPEN")) return "OPEN";
  if (normalized.includes("COPA")) return "COPA";
  if (normalized.includes("BRASILEIR") || normalized.includes("NACIONAL")) return "BRASILEIRAO";
  return "ESTADUAL";
}

const PAGE_SIZE = 24;

function formatClubMedalBadge(ouro: number, prata: number, bronze: number): string {
  const total = ouro + prata + bronze;
  return `🥇${ouro} 🥈${prata} 🥉${bronze} (${String(total).padStart(2, "0")})`;
}

export default function HomePage() {
  const router = useRouter();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [athletes, setAthletes] = useState<AthleteDirectoryRow[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [loadingAthletes, setLoadingAthletes] = useState(true);
  const [loadingClubs, setLoadingClubs] = useState(false);
  const [globalEfficiency, setGlobalEfficiency] = useState<GlobalEfficiencyResponse | null>(null);
  const [letterTab, setLetterTab] = useState("A");
  const [visibleAthletes, setVisibleAthletes] = useState(PAGE_SIZE);
  const [eventTypeFilter, setEventTypeFilter] = useState<EventTypeFilter>("ALL");
  const [eventStatusFilter, setEventStatusFilter] = useState<EventStatusFilter>("ALL");
  const [mobileEventFiltersOpen, setMobileEventFiltersOpen] = useState(false);
  const [athleteSearch, setAthleteSearch] = useState("");
  const letterButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    void apiGetEvents()
      .then((rows) => setEvents(rows as EventRow[]))
      .catch(() => setEvents([]))
      .finally(() => setLoadingEvents(false));

    void apiGetAthletesDirectory()
      .then((rows) => setAthletes(rows as AthleteDirectoryRow[]))
      .catch(() => setAthletes([]))
      .finally(() => setLoadingAthletes(false));
  }, []);

  const sortedEvents = useMemo(() => sortEventsByStatusAndDate(events), [events]);
  const highlightedEvent = useMemo(
    () =>
      sortedEvents.find((event) => event.userStatus !== "CONCLUIDO") ??
      sortedEvents.find((event) => event.userStatus === "CONCLUIDO") ??
      null,
    [sortedEvents],
  );

  useEffect(() => {
    setLoadingClubs(true);
    void apiGetGlobalEfficiency()
      .then((result) => setGlobalEfficiency(result))
      .catch(() => setGlobalEfficiency(null))
      .finally(() => setLoadingClubs(false));
  }, []);
  const filteredEvents = useMemo(() => {
    return sortedEvents.filter((event) => {
      const type = inferEventType(event);
      const status = event.userStatus === "CONCLUIDO" ? "DONE" : "OPEN";
      if (eventTypeFilter !== "ALL" && type !== eventTypeFilter) return false;
      if (eventStatusFilter !== "ALL" && status !== eventStatusFilter) return false;
      return true;
    });
  }, [eventStatusFilter, eventTypeFilter, sortedEvents]);

  const availableLetters = useMemo(() => {
    const letters = new Set<string>();
    for (const athlete of athletes) letters.add(athlete.firstLetter || "A");
    return [...letters].sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }));
  }, [athletes]);

  useEffect(() => {
    if (availableLetters.length === 0) return;
    if (!availableLetters.includes(letterTab)) setLetterTab(availableLetters[0]);
  }, [availableLetters, letterTab]);

  useEffect(() => {
    setVisibleAthletes(PAGE_SIZE);
  }, [letterTab]);

  useEffect(() => {
    const activeButton = letterButtonRefs.current[letterTab];
    if (!activeButton) return;
    activeButton.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [letterTab]);

  const athletesByLetter = useMemo(() => {
    const query = athleteSearch.trim().toUpperCase();
    return athletes.filter((athlete) => {
      if (!query && (athlete.firstLetter || "A") !== letterTab) return false;
      if (!query) return true;
      return (
        athlete.nameDisplay.toUpperCase().includes(query) ||
        athlete.nameReduced.toUpperCase().includes(query)
      );
    });
  }, [athleteSearch, athletes, letterTab]);

  const pagedAthletes = useMemo(
    () => athletesByLetter.slice(0, visibleAthletes),
    [athletesByLetter, visibleAthletes],
  );
  const hasMoreAthletes = athletesByLetter.length > visibleAthletes;

  return (
    <div className="user-theme home-theme">
      <UserHeader />
      <main className="container grid user-page">
        <Hero
          title="Plataforma de Tenis de Mesa Brasil"
          subtitle="PingPong Paid'egua"
          actions={
            <>
              <button
                type="button"
                onClick={() => router.push("/reportar-problema")}
                aria-label="Reportar problema"
              >
                Reportar problema
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => router.push("/colabore")}
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
              <h2>Próximo evento em destaque</h2>
              <Badge tone={highlightedEvent.userStatus === "CONCLUIDO" ? "done" : "open"}>
                {highlightedEvent.userStatus === "CONCLUIDO" ? "Concluído" : "Em disputa"}
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
              <button
                type="button"
                className="secondary"
                onClick={() => router.push(`/events/${highlightedEvent.id}/group-simulator`)}
                disabled={!highlightedEvent.groupSimulationEligible}
              >
                Simular Grupos
              </button>
            </div>
          </Card>
        ) : null}

        <Card id="eventos-em-destaque" className="grid" variant="event">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2>Eventos em destaque</h2>
            <Badge tone="default">Ordenado por situacao e data</Badge>
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
                  statusLabel={eventStatusLabel(event.userStatus)}
                  statusTone={eventStatusTone(event.userStatus)}
                  periodLabel={`${formatDate(event.dataInicio)} ate ${formatDate(event.dataFim)}`}
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

          {!loadingEvents && filteredEvents.length === 0 ? (
            <p className="arena-muted">Nenhum evento encontrado.</p>
          ) : null}
        </Card>

        <Card id="clubes-eficiencia" className="grid" variant="event">
          <div className="row home-athletes-header" style={{ justifyContent: "space-between" }}>
            <h2>Clubes</h2>
            <Badge tone="default">Todos os eventos da base</Badge>
          </div>
          <p className="home-club-medal-legend">🥇 Ouro • 🥈 Prata • 🥉 Bronze • (Total)</p>

          {loadingClubs ? (
            <div className="athlete-list-grid">
              <Skeleton height="60px" />
              <Skeleton height="60px" />
              <Skeleton height="60px" />
            </div>
          ) : (
            <div className="athlete-list-grid">
              {(globalEfficiency?.ranking ?? []).map((club) => (
                <article key={club.clubId} className="athlete-list-card">
                  <div>
                    <h3>{club.clubName}</h3>
                  </div>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <Badge tone="default">
                      {formatClubMedalBadge(club.ouro, club.prata, club.bronze)}
                    </Badge>
                    <button className="club-efficiency-button" onClick={() => router.push(`/eficiencia/${club.clubId}`)}>Eficiência</button>
                  </div>
                </article>
              ))}
            </div>
          )}

          {!loadingClubs && (globalEfficiency?.ranking?.length ?? 0) === 0 ? (
            <p className="arena-muted">Nenhum clube encontrado na base consolidada de eventos.</p>
          ) : null}
        </Card>

        <Card id="atletas-da-base" className="grid" variant="athlete">
            <div className="row home-athletes-header" style={{ justifyContent: "space-between" }}>
              <h2>Atletas da base</h2>
            <div className="balloon-group letter-tab-strip letter-tab-sticky" role="group" aria-label="Filtro por letra">
              {availableLetters.map((letter) => (
                <button
                  key={letter}
                  type="button"
                  ref={(element) => {
                    letterButtonRefs.current[letter] = element;
                  }}
                  className={`balloon-button ${letterTab === letter ? "active" : ""}`}
                  onClick={() => setLetterTab(letter)}
                >
                  {letter}
                </button>
              ))}
            </div>
            <input
              className="home-athletes-search"
              value={athleteSearch}
              onChange={(event) => setAthleteSearch(event.target.value)}
              placeholder="Buscar atleta por nome"
              aria-label="Buscar atleta por nome"
              autoCapitalize="none"
              autoCorrect="off"
            />
          </div>

          {loadingAthletes ? (
            <div className="grid">
              <Skeleton height="60px" />
              <Skeleton height="60px" />
              <Skeleton height="60px" />
            </div>
          ) : (
            <div className="athlete-list-grid">
              {pagedAthletes.map((athlete) => (
                <article key={athlete.athleteKey} className="athlete-list-card">
                  <div>
                    <h3>{athlete.nameDisplay}</h3>
                    <p className="arena-muted">{athlete.nameReduced || "-"}</p>
                  </div>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <Badge tone="default">Eventos: {String(athlete.totalEvents)}</Badge>
                    <button onClick={() => router.push(`/career/${encodeURIComponent(athlete.athleteKey)}`)}>
                      Carreira
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}

          {!loadingAthletes && athletesByLetter.length === 0 ? (
            <p className="arena-muted">Nenhum atleta para a letra selecionada.</p>
          ) : null}

          {!loadingAthletes && hasMoreAthletes ? (
            <div className="row" style={{ justifyContent: "center" }}>
              <button onClick={() => setVisibleAthletes((current) => current + PAGE_SIZE)}>Carregar mais atletas</button>
            </div>
          ) : null}
        </Card>

        <footer className="arena-footer">
          <p>PingPong Paid'egua © {new Date().getFullYear()} - Plataforma de Tenis de Mesa Brasil</p>
        </footer>
      </main>
    </div>
  );
}

