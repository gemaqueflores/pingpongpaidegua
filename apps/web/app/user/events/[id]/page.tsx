"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  apiGetAthletes,
  apiGetClubAthletes,
  apiGetClubs,
  apiGetEvents,
  type UserEventRow,
} from "../../../../lib/user-api";
import { Hero } from "../../../../components/ui/Hero";
import { Card } from "../../../../components/ui/Card";
import { Badge } from "../../../../components/ui/Badge";
import { Skeleton } from "../../../../components/ui/Skeleton";

type EventRow = UserEventRow;
type EventTab = "grupos" | "clubes" | "atletas";

type ClubRow = {
  id: number;
  name: string;
  athleteCount?: number;
};

type AthleteRow = {
  id: number;
  nameDisplay?: string;
  name?: string;
  stateCode?: string | null;
  region?: string | null;
  club?: { name: string } | null;
};

function formatAthleteFederation(athlete: AthleteRow): string {
  if (!athlete.stateCode || !athlete.region) {
    return "-";
  }
  return `${athlete.stateCode} - ${athlete.region}`;
}

function formatDate(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("pt-BR");
}

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleString("pt-BR");
}

function inferEventType(name: string): "ESTADUAL" | "COPA" | "BRASILEIRAO" | "OPEN" {
  const normalized = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
  if (normalized.includes("OPEN")) return "OPEN";
  if (normalized.includes("COPA")) return "COPA";
  if (normalized.includes("BRASILEIR") || normalized.includes("NACIONAL")) return "BRASILEIRAO";
  return "ESTADUAL";
}

function resolveEventStatusLabel(event: EventRow | null): string {
  if (!event) {
    return "-";
  }

  if (event.concluido || event.situacaoComputada === "POS_EVENTO") {
    return "Encerrado";
  }

  if (event.situacaoComputada === "EM_ANDAMENTO") {
    return "Em Realização";
  }

  if (event.situacaoComputada === "POS_INSCRICOES_PRE_EVENTO") {
    return event.groupsDefined ? "Grupos Divulgados" : "Formação de Grupos";
  }

  if (event.situacaoComputada === "INSCRICOES_ABERTAS" || event.situacaoComputada === "PRE_INSCRICOES") {
    return "Inscrições Abertas";
  }

  if (event.situacaoComputada === "DRAFT") {
    return "Formação de Grupos";
  }

  return "-";
}

export default function EventDetailPage() {
  const params = useParams<{ id: string }>();
  const eventId = Number(params.id);

  const [event, setEvent] = useState<EventRow | null>(null);
  const [activeTab, setActiveTab] = useState<EventTab>("grupos");

  const [clubs, setClubs] = useState<ClubRow[]>([]);
  const [clubsLoading, setClubsLoading] = useState(false);
  const [clubSearch, setClubSearch] = useState("");
  const [expandedClubs, setExpandedClubs] = useState<Record<number, boolean>>({});
  const [clubAthletesByClub, setClubAthletesByClub] = useState<Record<number, AthleteRow[]>>({});
  const [clubCountFallbackById, setClubCountFallbackById] = useState<Record<number, number>>({});
  const [clubLoadingById, setClubLoadingById] = useState<Record<number, boolean>>({});

  const [athleteSearch, setAthleteSearch] = useState("");
  const [athletes, setAthletes] = useState<AthleteRow[]>([]);
  const [loadingEvent, setLoadingEvent] = useState(true);

  useEffect(() => {
    void apiGetEvents()
      .then((events) => {
        setEvent((events as EventRow[]).find((item) => item.id === eventId) ?? null);
      })
      .finally(() => setLoadingEvent(false));
  }, [eventId]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      void apiGetAthletes(eventId, athleteSearch).then((rows) => setAthletes(rows as AthleteRow[]));
    }, 250);
    return () => clearTimeout(timeout);
  }, [eventId, athleteSearch]);

  useEffect(() => {
    setClubsLoading(true);
    setExpandedClubs({});
    setClubAthletesByClub({});
    setClubCountFallbackById({});
    void apiGetClubs(eventId)
      .then((rows) => {
        const clubRows = rows as ClubRow[];
        setClubs(clubRows);

        const missingCount = clubRows.filter((club) => !Number.isFinite(club.athleteCount));
        if (missingCount.length > 0) {
          void hydrateMissingClubCounts(missingCount);
        }
      })
      .finally(() => setClubsLoading(false));
  }, [eventId]);

  async function hydrateMissingClubCounts(clubRows: ClubRow[]) {
    const entries = await Promise.all(
      clubRows.map(async (club) => {
        try {
          const data = await apiGetClubAthletes(eventId, club.id);
          const athletes = (data.athletes ?? []) as AthleteRow[];
          return [club.id, athletes.length] as const;
        } catch {
          return [club.id, 0] as const;
        }
      }),
    );

    setClubCountFallbackById((previous) => {
      const next = { ...previous };
      for (const [clubId, count] of entries) {
        next[clubId] = count;
      }
      return next;
    });
  }

  async function toggleClub(clubId: number) {
    const isExpanded = Boolean(expandedClubs[clubId]);
    if (isExpanded) {
      setExpandedClubs((previous) => ({ ...previous, [clubId]: false }));
      return;
    }

    setExpandedClubs((previous) => ({ ...previous, [clubId]: true }));
    if (clubAthletesByClub[clubId]) return;

    setClubLoadingById((previous) => ({ ...previous, [clubId]: true }));
    try {
      const data = await apiGetClubAthletes(eventId, clubId);
      setClubAthletesByClub((previous) => ({
        ...previous,
        [clubId]: (data.athletes ?? []) as AthleteRow[],
      }));
    } finally {
      setClubLoadingById((previous) => ({ ...previous, [clubId]: false }));
    }
  }

  const filteredClubs = useMemo(() => {
    const query = clubSearch.trim().toUpperCase();
    if (!query) return clubs;
    return clubs.filter((club) => club.name.toUpperCase().includes(query));
  }, [clubSearch, clubs]);

  const eventType = event
    ? event.nivel === "OPEN"
      ? "OPEN"
      : inferEventType(event.nome)
    : null;

  const statusLabel = resolveEventStatusLabel(event);

  const tabs: Array<{ id: EventTab; label: string }> = [
    { id: "grupos", label: "Grupos" },
    { id: "clubes", label: "Clubes" },
    { id: "atletas", label: "Atletas" },
  ];

  return (
    <main className="container grid user-page">
      <Hero
        title={event ? event.nome : `Evento ${eventId}`}
        subtitle="Tênis de Mesa / Table Tennis"
        actions={<button onClick={() => (window.location.href = "/")}>Voltar</button>}
      />

      {loadingEvent ? (
        <Card className="grid">
          <Skeleton height="24px" />
          <Skeleton height="20px" />
        </Card>
      ) : (
        <Card className="grid" variant="event">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2>Resumo do evento</h2>
            <div className="row">
              <Badge tone={event?.userStatus === "CONCLUIDO" ? "done" : "open"}>
                {event?.userStatus === "CONCLUIDO" ? "Concluído" : "Em disputa"}
              </Badge>
              {eventType ? (
                <Badge tone="default">
                  {eventType === "BRASILEIRAO" ? "Brasileirão" : eventType}
                </Badge>
              ) : null}
              <Badge tone="default">Último atualização: {formatDateTime(event?.lastScrapeAt ?? null)}</Badge>
            </div>
          </div>
          <p>
            Período: <strong>{formatDate(event?.dataInicio ?? null)} até {formatDate(event?.dataFim ?? null)}</strong>
          </p>
          <div className="event-metrics">
            <span>Inscritos: <strong>{String(event?.totalInscritos ?? 0)}</strong></span>
            <span>Categorias: <strong>{String(event?.totalCategorias ?? 0)}</strong></span>
            <span>Técnicos: <strong>{String(event?.totalTecnicos ?? 0)}</strong></span>
            <span>Status: <strong>{statusLabel}</strong></span>
          </div>
          <div className="balloon-group letter-tab-strip" role="tablist" aria-label="Seções do evento">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                className={`balloon-button ${activeTab === tab.id ? "active" : ""}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </Card>
      )}

      {activeTab === "grupos" ? (
        <Card className="grid">
          <h2>Grupos</h2>
          {event?.groupsDefined ? <p>Grupos oficiais já divulgados para este evento.</p> : null}
          <div className="row">
            <button
              onClick={() => (window.location.href = `/user/events/${eventId}/group-simulator`)}
              disabled={Boolean(event?.groupsDefined) || !Boolean(event?.groupSimulationEligible)}
              title={event?.groupsDefined ? "Simulação indisponível: grupos oficiais já publicados." : undefined}
            >
              {event?.groupsDefined ? "Simulação bloqueada (grupos publicados)" : "Simular Grupos"}
            </button>
          </div>
          {!event?.groupsDefined && !event?.groupSimulationEligible ? (
            <p className="arena-muted">Simulador indisponível para o momento atual do evento.</p>
          ) : null}
        </Card>
      ) : null}

      {activeTab === "clubes" ? (
        <Card className="grid">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2>Clubes</h2>
            <input
              className="home-athletes-search"
              value={clubSearch}
              onChange={(event) => setClubSearch(event.target.value)}
              placeholder="Buscar clube"
              aria-label="Buscar clube"
              autoCapitalize="none"
              autoCorrect="off"
            />
          </div>
          {clubsLoading ? <p>Carregando clubes...</p> : null}
          {!clubsLoading && filteredClubs.length === 0 ? <p>Nenhum clube encontrado para este evento.</p> : null}

          <div className="grid">
            {filteredClubs.map((club) => {
              const isExpanded = Boolean(expandedClubs[club.id]);
              const athletesInClub = clubAthletesByClub[club.id] ?? [];
              const resolvedCount =
                (Number.isFinite(club.athleteCount) ? Number(club.athleteCount) : null) ??
                clubCountFallbackById[club.id] ??
                athletesInClub.length;
              return (
                <article key={club.id} className="athlete-list-card">
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <h3 style={{ margin: 0 }}>{club.name}</h3>
                    <Badge tone="default">{resolvedCount} atletas</Badge>
                  </div>
                  <div className="row">
                    <button onClick={() => toggleClub(club.id)}>
                      {isExpanded ? "Recolher atletas" : "Expandir atletas"}
                    </button>
                  </div>

                  {isExpanded ? (
                    <div className="grid">
                      {clubLoadingById[club.id] ? <p>Carregando atletas...</p> : null}
                      {!clubLoadingById[club.id] && athletesInClub.length === 0 ? (
                        <p>Nenhum atleta listado para este clube.</p>
                      ) : null}
                      {!clubLoadingById[club.id] && athletesInClub.length > 0 ? (
                        <ul>
                          {athletesInClub.map((athlete) => (
                            <li key={athlete.id}>
                              <a href={`/user/events/${eventId}/athletes/${athlete.id}`}>
                                {athlete.nameDisplay ?? athlete.name}
                              </a>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </Card>
      ) : null}

      {activeTab === "atletas" ? (
        <Card className="grid">
          <h2>Atletas do evento</h2>
          <input
            className="home-athletes-search"
            value={athleteSearch}
            onChange={(event) => setAthleteSearch(event.target.value)}
            placeholder="Buscar atleta"
            autoCapitalize="none"
            autoCorrect="off"
          />
          <table className="data-table">
            <thead>
              <tr>
                <th>Atleta</th>
                <th>Clube</th>
                <th>UF/Região</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {athletes.map((athlete) => (
                <tr key={athlete.id}>
                  <td>{athlete.nameDisplay ?? athlete.name}</td>
                  <td>{athlete.club?.name ?? "-"}</td>
                  <td>{formatAthleteFederation(athlete)}</td>
                  <td>
                    <a href={`/user/events/${eventId}/athletes/${athlete.id}`}>Detalhes</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}
    </main>
  );
}

