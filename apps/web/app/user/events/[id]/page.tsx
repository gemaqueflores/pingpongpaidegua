"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  apiGetAthletes,
  apiGetClubAthletes,
  apiGetClubs,
  apiGetEvents,
  type UserEventRow,
} from "../../../../lib/user-api";

type EventRow = UserEventRow;

type ClubRow = {
  id: number;
  name: string;
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

export default function EventDetailPage() {
  const params = useParams<{ id: string }>();
  const eventId = Number(params.id);

  const [event, setEvent] = useState<EventRow | null>(null);

  const [clubs, setClubs] = useState<ClubRow[]>([]);
  const [clubsLoading, setClubsLoading] = useState(false);
  const [expandedClubs, setExpandedClubs] = useState<Record<number, boolean>>({});
  const [clubAthletesByClub, setClubAthletesByClub] = useState<Record<number, AthleteRow[]>>({});
  const [clubLoadingById, setClubLoadingById] = useState<Record<number, boolean>>({});

  const [athleteSearch, setAthleteSearch] = useState("");
  const [athletes, setAthletes] = useState<AthleteRow[]>([]);

  useEffect(() => {
    void apiGetEvents().then((events) => {
      setEvent((events as EventRow[]).find((item) => item.id === eventId) ?? null);
    });
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
    void apiGetClubs(eventId)
      .then((rows) => setClubs(rows as ClubRow[]))
      .finally(() => setClubsLoading(false));
  }, [eventId]);

  async function toggleClub(clubId: number) {
    const isExpanded = Boolean(expandedClubs[clubId]);
    if (isExpanded) {
      setExpandedClubs((previous) => ({ ...previous, [clubId]: false }));
      return;
    }

    setExpandedClubs((previous) => ({ ...previous, [clubId]: true }));

    if (clubAthletesByClub[clubId]) {
      return;
    }

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

  return (
    <main className="container grid user-page">
      <section className="hero-header">
        <h1 className="hero-title">{event ? event.nome : `Evento ${eventId}`}</h1>
        <p className="hero-subtitle">Tênis de Mesa / Table Tennis</p>
        <div className="row" style={{ marginTop: 8 }}>
          <button onClick={() => (window.location.href = "/")}>Voltar</button>
        </div>
      </section>

      <section className="card arena-card grid">
        <h2>Grupos</h2>
        {event?.groupsDefined ? <p>Este evento já possui grupos oficiais definidos.</p> : null}
        {!event?.groupsDefined && event?.groupSimulationEligible ? (
          <div className="row">
            <button onClick={() => (window.location.href = `/user/events/${eventId}/group-simulator`)}>
              Simulador de Grupos
            </button>
          </div>
        ) : null}
        {!event?.groupsDefined && !event?.groupSimulationEligible ? (
          <p className="arena-muted">Simulador indisponível para a situação atual do evento.</p>
        ) : null}
      </section>

      <section className="card arena-card grid">
        <h2>Clubes</h2>
        <p className="arena-muted">Selecione um clube para expandir ou recolher seus atletas.</p>
        {clubsLoading ? <p>Carregando clubes...</p> : null}
        {!clubsLoading && clubs.length === 0 ? <p>Nenhum clube encontrado para este evento.</p> : null}

        <table className="data-table">
          <thead>
            <tr>
              <th>Clube</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {clubs.map((club) => {
              const isExpanded = Boolean(expandedClubs[club.id]);
              const athletesInClub = clubAthletesByClub[club.id] ?? [];
              return (
                <tr key={club.id}>
                  <td>
                    <strong>{club.name}</strong>
                    {isExpanded ? (
                      <div style={{ marginTop: 8 }}>
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
                  </td>
                  <td>
                    <button onClick={() => toggleClub(club.id)}>
                      {isExpanded ? "Recolher atletas" : "Expandir atletas"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="card arena-card grid">
        <h2>Atletas do evento</h2>
        <input
          value={athleteSearch}
          onChange={(currentEvent) => setAthleteSearch(currentEvent.target.value)}
          placeholder="Buscar atleta"
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
      </section>
    </main>
  );
}
