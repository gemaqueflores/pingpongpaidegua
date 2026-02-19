"use client";

import React from "react";
import type { ClubEfficiencyCareerResponse } from "../../lib/user-api";
import { Badge } from "../ui/Badge";
import { Card } from "../ui/Card";
import { DataTableResponsive } from "../ui/DataTableResponsive";

function formatNumber(value: number): string {
  return new Intl.NumberFormat("pt-BR").format(value);
}

function formatDate(value: string | null): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Belem",
  }).format(new Date(value));
}

function medalEmoji(medalha: "ouro" | "prata" | "bronze"): string {
  if (medalha === "ouro") return "🥇";
  if (medalha === "prata") return "🥈";
  return "🥉";
}

export function ClubEfficiencyCareerPanel(props: {
  data: ClubEfficiencyCareerResponse;
  expandedEvents: Record<number, boolean>;
  onToggleEvent: (eventId: number) => void;
}) {
  const { data, expandedEvents, onToggleEvent } = props;
  const medalBars = [
    { medal: "🥇", label: "Ouro", value: data.summary.medalhasTotais.ouro, className: "gold" },
    { medal: "🥈", label: "Prata", value: data.summary.medalhasTotais.prata, className: "silver" },
    { medal: "🥉", label: "Bronze", value: data.summary.medalhasTotais.bronze, className: "bronze" },
  ] as const;
  const maxMedalValue = Math.max(...medalBars.map((item) => item.value), 1);

  return (
    <>
      <Card className="grid club-efficiency-section" variant="stat">
        <div className="club-hero-stats-grid" aria-label="Resumo estatístico do clube">
          <div className="club-hero-stat">
            <span className="club-hero-stat-label">Eventos computados</span>
            <strong className="club-hero-stat-value">{formatNumber(data.summary.nEventos)}</strong>
          </div>
          <div className="club-hero-stat">
            <span className="club-hero-stat-label">Total de medalhas</span>
            <strong className="club-hero-stat-value">{formatNumber(data.summary.medalhasTotais.total)}</strong>
          </div>
          <div className="club-hero-stat">
            <span className="club-hero-stat-label">Atletas no último evento</span>
            <strong className="club-hero-stat-value">{formatNumber(data.summary.nAtletasUltimoEvento)}</strong>
          </div>
          <div className="club-hero-stat">
            <span className="club-hero-stat-label">Atletas no próximo evento</span>
            <strong className="club-hero-stat-value">{formatNumber(data.summary.nAtletasProximoEvento)}</strong>
          </div>
        </div>

        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <Badge tone={data.summary.ultimoEventoNome ? "done" : "default"}>
            Último evento: {data.summary.ultimoEventoNome ?? "-"}
          </Badge>
          <Badge tone={data.summary.proximoEventoNome ? "open" : "default"}>
            Próximo evento: {data.summary.proximoEventoNome ?? "-"}
          </Badge>
          <Badge tone="default">
            {`🥇${formatNumber(data.summary.medalhasTotais.ouro)} 🥈${formatNumber(data.summary.medalhasTotais.prata)} 🥉${formatNumber(data.summary.medalhasTotais.bronze)} (${formatNumber(data.summary.medalhasTotais.total)})`}
          </Badge>
        </div>

        <div className="club-medal-bars" aria-label="Distribuição de medalhas">
          {medalBars.map((item) => {
            const widthPercent = Math.round((item.value / maxMedalValue) * 100);
            return (
              <div key={item.label} className="club-medal-bar-row">
                <span className="club-medal-bar-label">
                  {item.medal} {item.label}
                </span>
                <div className="club-medal-bar-track" role="presentation">
                  <div
                    className={`club-medal-bar-fill ${item.className}`}
                    style={{ width: `${Math.max(widthPercent, item.value > 0 ? 8 : 0)}%` }}
                  />
                </div>
                <strong className="club-medal-bar-value">{formatNumber(item.value)}</strong>
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="grid club-efficiency-section club-efficiency-section-strong" variant="event">
        <h2 style={{ margin: 0 }}>Histórico por evento</h2>
        <DataTableResponsive
          rows={data.history}
          empty={<p className="arena-muted">Sem histórico de eventos para este clube.</p>}
          columns={[
            {
              key: "evento",
              header: "Evento",
              render: (eventRow) => (
                <>
                  <strong>{eventRow.eventName}</strong>
                  <br />
                  <small>{formatDate(eventRow.dataInicio)} até {formatDate(eventRow.dataFim)}</small>
                </>
              ),
            },
            {
              key: "tipo",
              header: "Tipo",
              render: (eventRow) => (eventRow.eventType === "BRASILEIRAO" ? "BRASILEIRÃO" : eventRow.eventType),
            },
            { key: "atletas", header: "Atletas", render: (eventRow) => formatNumber(eventRow.athleteCount) },
            { key: "ouro", header: "🥇", render: (eventRow) => formatNumber(eventRow.ouro) },
            { key: "prata", header: "🥈", render: (eventRow) => formatNumber(eventRow.prata) },
            { key: "bronze", header: "🥉", render: (eventRow) => formatNumber(eventRow.bronze) },
            { key: "total", header: "Total", render: (eventRow) => <strong>{formatNumber(eventRow.totalQuantidade)}</strong> },
            {
              key: "acoes",
              header: "Ações",
              render: (eventRow) => (
                <div className="grid" style={{ gap: 8 }}>
                  <button type="button" onClick={() => onToggleEvent(eventRow.eventId)}>
                    {expandedEvents[eventRow.eventId] ? "Ocultar medalhistas" : "Ver medalhistas"}
                  </button>
                  {expandedEvents[eventRow.eventId] ? (
                    eventRow.medalists.length === 0 ? (
                      <p style={{ margin: 0 }}>Sem medalhistas registrados.</p>
                    ) : (
                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                        {eventRow.medalists.map((medalist) => (
                          <li key={`${eventRow.eventId}-${medalist.athleteId}-${medalist.categoryName}-${medalist.medalha}`}>
                            {medalEmoji(medalist.medalha)} {medalist.athleteName} · {medalist.categoryName}
                          </li>
                        ))}
                      </ul>
                    )
                  ) : null}
                </div>
              ),
            },
          ]}
          mobileCard={(eventRow) => (
            <article key={eventRow.eventId} className="athlete-list-card">
              <strong>{eventRow.eventName}</strong>
              <p className="arena-muted" style={{ margin: 0 }}>{formatDate(eventRow.dataInicio)} até {formatDate(eventRow.dataFim)}</p>
              <p className="arena-muted" style={{ margin: 0 }}>
                Tipo {eventRow.eventType === "BRASILEIRAO" ? "BRASILEIRÃO" : eventRow.eventType} · Atletas {formatNumber(eventRow.athleteCount)}
              </p>
              <p style={{ margin: 0 }}>🥇 {formatNumber(eventRow.ouro)} · 🥈 {formatNumber(eventRow.prata)} · 🥉 {formatNumber(eventRow.bronze)} · <strong>Total {formatNumber(eventRow.totalQuantidade)}</strong></p>
              <button type="button" onClick={() => onToggleEvent(eventRow.eventId)}>
                {expandedEvents[eventRow.eventId] ? "Ocultar medalhistas" : "Ver medalhistas"}
              </button>
              {expandedEvents[eventRow.eventId] ? (
                eventRow.medalists.length === 0 ? (
                  <p style={{ margin: 0 }}>Sem medalhistas registrados para este clube no evento.</p>
                ) : (
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {eventRow.medalists.map((medalist) => (
                      <li key={`${eventRow.eventId}-${medalist.athleteId}-${medalist.categoryName}-${medalist.medalha}`}>
                        {medalEmoji(medalist.medalha)} {medalist.athleteName} · {medalist.categoryName}
                      </li>
                    ))}
                  </ul>
                )
              ) : null}
            </article>
          )}
        />
      </Card>

      <Card className="grid club-efficiency-section club-efficiency-section-strong" variant="event">
        <h2 style={{ margin: 0 }}>Contribuição por atleta</h2>
        <DataTableResponsive
          rows={data.athletesContribution}
          empty={<p className="arena-muted">Sem contribuição de atletas para exibir.</p>}
          columns={[
            { key: "atleta", header: "Atleta", render: (athlete) => athlete.athleteName },
            { key: "eventos", header: "Eventos", render: (athlete) => formatNumber(athlete.eventos) },
            { key: "ouro", header: "🥇", render: (athlete) => formatNumber(athlete.ouro) },
            { key: "prata", header: "🥈", render: (athlete) => formatNumber(athlete.prata) },
            { key: "bronze", header: "🥉", render: (athlete) => formatNumber(athlete.bronze) },
            { key: "total", header: "Total", render: (athlete) => <strong>{formatNumber(athlete.totalQuantidade)}</strong> },
          ]}
          mobileCard={(athlete) => (
            <article key={athlete.athleteId} className="athlete-list-card">
              <strong>{athlete.athleteName}</strong>
              <p className="arena-muted" style={{ margin: 0 }}>
                Eventos {formatNumber(athlete.eventos)} · 🥇 {formatNumber(athlete.ouro)} · 🥈 {formatNumber(athlete.prata)} · 🥉 {formatNumber(athlete.bronze)}
              </p>
              <p style={{ margin: 0 }}><strong>Total {formatNumber(athlete.totalQuantidade)}</strong></p>
            </article>
          )}
        />
      </Card>
    </>
  );
}
