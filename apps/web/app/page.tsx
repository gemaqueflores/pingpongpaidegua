"use client";

import { useEffect, useMemo, useState } from "react";
import { apiGetAthletesDirectory, apiGetEvents, type UserEventRow } from "../lib/user-api";

type EventRow = UserEventRow;

type AthleteDirectoryRow = {
  athleteKey: string;
  nameDisplay: string;
  nameReduced: string;
  firstLetter: string;
  totalEvents: number;
  totalAthleteRecords: number;
};

type EventListTab = "EM ABERTO" | "CONCLUIDOS";

function formatDate(value: string | null): string {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleDateString("pt-BR");
}

function eventStatusLabel(status: EventRow["userStatus"]): string {
  if (status === "INSCRICOES_ABERTAS") {
    return "Inscrições abertas";
  }
  if (status === "INSCRICOES_ENCERRADAS") {
    return "Inscrições encerradas";
  }
  return "Concluído";
}

function sortEventsByStatus(rows: EventRow[]): EventRow[] {
  const orderMap: Record<EventRow["userStatus"], number> = {
    INSCRICOES_ABERTAS: 1,
    INSCRICOES_ENCERRADAS: 2,
    CONCLUIDO: 3,
  };

  return [...rows].sort((a, b) => {
    const orderDiff = orderMap[a.userStatus] - orderMap[b.userStatus];
    if (orderDiff !== 0) {
      return orderDiff;
    }

    const dateA = a.dataInicio ? new Date(a.dataInicio).getTime() : 0;
    const dateB = b.dataInicio ? new Date(b.dataInicio).getTime() : 0;
    if (dateA !== dateB) {
      return dateB - dateA;
    }

    return a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" });
  });
}

export default function HomePage() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [athletes, setAthletes] = useState<AthleteDirectoryRow[]>([]);
  const [eventTab, setEventTab] = useState<EventListTab>("EM ABERTO");
  const [letterTab, setLetterTab] = useState("A");

  useEffect(() => {
    void apiGetEvents().then((rows) => setEvents(rows as EventRow[])).catch(() => setEvents([]));
    void apiGetAthletesDirectory().then((rows) => setAthletes(rows as AthleteDirectoryRow[])).catch(() => setAthletes([]));
  }, []);

  const sortedEvents = useMemo(() => sortEventsByStatus(events), [events]);

  const visibleEvents = useMemo(() => {
    if (eventTab === "CONCLUIDOS") {
      return sortedEvents.filter((event) => event.userStatus === "CONCLUIDO");
    }
    return sortedEvents.filter((event) => event.userStatus !== "CONCLUIDO");
  }, [eventTab, sortedEvents]);

  const availableLetters = useMemo(() => {
    const letters = new Set<string>();
    for (const athlete of athletes) {
      letters.add(athlete.firstLetter || "A");
    }
    return [...letters].sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }));
  }, [athletes]);

  useEffect(() => {
    if (availableLetters.length === 0) {
      return;
    }
    if (!availableLetters.includes(letterTab)) {
      setLetterTab(availableLetters[0]);
    }
  }, [availableLetters, letterTab]);

  const athletesByLetter = useMemo(() => {
    return athletes.filter((athlete) => (athlete.firstLetter || "A") === letterTab);
  }, [athletes, letterTab]);

  return (
    <div className="user-theme home-theme">
      <main className="container grid user-page">
        <section className="hero-header">
          <h1 className="hero-title">PingPong Paid'egua</h1>
          <p className="hero-subtitle">Tênis de Mesa / Table Tennis</p>
          <div className="row">
            <button type="button" onClick={() => (window.location.href = "/user/reportar-problema")}>
              Reportar problema
            </button>
            <button type="button" className="secondary" onClick={() => (window.location.href = "/user/colabore")}>
              Colabore com o projeto
            </button>
          </div>
        </section>

        <section className="card arena-card grid">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2>Eventos</h2>
          <div className="balloon-group" role="group" aria-label="Filtro de eventos">
            <button
              type="button"
              className={`balloon-button ${eventTab === "EM ABERTO" ? "active" : ""}`}
              onClick={() => setEventTab("EM ABERTO")}
            >
              Em Aberto
            </button>
            <button
              type="button"
              className={`balloon-button ${eventTab === "CONCLUIDOS" ? "active" : ""}`}
              onClick={() => setEventTab("CONCLUIDOS")}
            >
              Concluídos
            </button>
          </div>
        </div>

        <table className="data-table">
          <thead>
            <tr>
              <th>Evento CBTM</th>
              <th>Nome</th>
              <th>Status</th>
              <th>Categorias</th>
              <th>Inscritos</th>
              <th>Período</th>
              <th>Grupos</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {visibleEvents.map((event) => (
              <tr key={event.id}>
                <td>{event.cbtmEventId}</td>
                <td>{event.nome}</td>
                <td>
                  <span className="pill">{eventStatusLabel(event.userStatus)}</span>
                </td>
                <td>{event.totalCategorias}</td>
                <td>{event.totalInscritos}</td>
                <td>
                  {formatDate(event.dataInicio)} até {formatDate(event.dataFim)}
                </td>
                <td>
                  {event.groupsDefined ? (
                    <span>Definidos</span>
                  ) : event.groupSimulationEligible ? (
                    <button onClick={() => (window.location.href = `/user/events/${event.id}/group-simulator`)}>
                      Simular Grupos
                    </button>
                  ) : (
                    <span>-</span>
                  )}
                </td>
                <td>
                  {event.userStatus === "CONCLUIDO" ? (
                    <button onClick={() => (window.location.href = `/user/events/${event.id}`)}>Abrir</button>
                  ) : (
                    <button onClick={() => (window.location.href = `/user/events/${event.id}`)}>Inscritos</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {visibleEvents.length === 0 ? <p className="arena-muted">Nenhum evento nessa listagem.</p> : null}
        </section>

        <section className="card arena-card grid">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2>Atletas da base</h2>
          <div className="balloon-group" role="group" aria-label="Filtro por letra">
            {availableLetters.map((letter) => (
              <button
                key={letter}
                type="button"
                className={`balloon-button ${letterTab === letter ? "active" : ""}`}
                onClick={() => setLetterTab(letter)}
              >
                {letter}
              </button>
            ))}
          </div>
        </div>

        <table className="data-table">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Nome reduzido</th>
              <th>Eventos</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {athletesByLetter.map((athlete) => (
              <tr key={athlete.athleteKey}>
                <td>{athlete.nameDisplay}</td>
                <td>{athlete.nameReduced || "-"}</td>
                <td>{athlete.totalEvents}</td>
                <td>
                  <button onClick={() => (window.location.href = `/user/career/${encodeURIComponent(athlete.athleteKey)}`)}>
                    Carreira
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {athletesByLetter.length === 0 ? <p className="arena-muted">Nenhum atleta para a letra selecionada.</p> : null}
        </section>
      </main>
    </div>
  );
}
