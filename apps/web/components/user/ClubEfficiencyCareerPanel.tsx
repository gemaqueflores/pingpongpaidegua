"use client";

import React, { Fragment } from "react";
import type { ClubEfficiencyCareerResponse } from "../../lib/user-api";
import { Badge } from "../ui/Badge";
import { Card } from "../ui/Card";

function formatNumber(value: number): string {
  return new Intl.NumberFormat("pt-BR").format(value);
}

function formatDate(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("pt-BR");
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

  return (
    <>
      <Card className="grid" variant="stat">
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <Badge tone="default">Eventos computados: {formatNumber(data.summary.nEventos)}</Badge>
          <Badge tone={data.summary.ultimoEventoNome ? "done" : "default"}>
            Último evento: {data.summary.ultimoEventoNome ?? "-"}
          </Badge>
          <Badge tone="default">Atletas no último evento: {formatNumber(data.summary.nAtletasUltimoEvento)}</Badge>
          <Badge tone={data.summary.proximoEventoNome ? "open" : "default"}>
            Próximo evento: {data.summary.proximoEventoNome ?? "-"}
          </Badge>
          <Badge tone="default">Atletas no próximo evento: {formatNumber(data.summary.nAtletasProximoEvento)}</Badge>
          <Badge tone="default">
            {`🥇${formatNumber(data.summary.medalhasTotais.ouro)} 🥈${formatNumber(data.summary.medalhasTotais.prata)} 🥉${formatNumber(data.summary.medalhasTotais.bronze)} (${formatNumber(data.summary.medalhasTotais.total)})`}
          </Badge>
        </div>
      </Card>

      <Card className="grid" variant="event">
        <h2 style={{ margin: 0 }}>Histórico por evento</h2>
        <div className="global-mobile-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Evento</th>
                <th>Tipo</th>
                <th>Atletas</th>
                <th>🥇</th>
                <th>🥈</th>
                <th>🥉</th>
                <th>Total</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {data.history.map((eventRow) => (
                <Fragment key={eventRow.eventId}>
                  <tr>
                    <td>
                      <strong>{eventRow.eventName}</strong>
                      <br />
                      <small>
                        {formatDate(eventRow.dataInicio)} até {formatDate(eventRow.dataFim)}
                      </small>
                    </td>
                    <td>{eventRow.eventType === "BRASILEIRAO" ? "BRASILEIRÃO" : eventRow.eventType}</td>
                    <td>{formatNumber(eventRow.athleteCount)}</td>
                    <td>{formatNumber(eventRow.ouro)}</td>
                    <td>{formatNumber(eventRow.prata)}</td>
                    <td>{formatNumber(eventRow.bronze)}</td>
                    <td>
                      <strong>{formatNumber(eventRow.totalQuantidade)}</strong>
                    </td>
                    <td>
                      <button type="button" onClick={() => onToggleEvent(eventRow.eventId)}>
                        {expandedEvents[eventRow.eventId] ? "Ocultar medalhistas" : "Ver medalhistas"}
                      </button>
                    </td>
                  </tr>
                  {expandedEvents[eventRow.eventId] ? (
                    <tr>
                      <td colSpan={8}>
                        {eventRow.medalists.length === 0 ? (
                          <p style={{ margin: 0 }}>Sem medalhistas registrados para este clube no evento.</p>
                        ) : (
                          <ul style={{ margin: 0, paddingLeft: 18 }}>
                            {eventRow.medalists.map((medalist) => (
                              <li key={`${eventRow.eventId}-${medalist.athleteId}-${medalist.categoryName}-${medalist.medalha}`}>
                                {medalEmoji(medalist.medalha)} {medalist.athleteName} · {medalist.categoryName}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="grid" variant="event">
        <h2 style={{ margin: 0 }}>Contribuição por atleta</h2>
        <div className="global-mobile-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Atleta</th>
                <th>Eventos</th>
                <th>🥇</th>
                <th>🥈</th>
                <th>🥉</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {data.athletesContribution.map((athlete) => (
                <tr key={athlete.athleteId}>
                  <td>{athlete.athleteName}</td>
                  <td>{formatNumber(athlete.eventos)}</td>
                  <td>{formatNumber(athlete.ouro)}</td>
                  <td>{formatNumber(athlete.prata)}</td>
                  <td>{formatNumber(athlete.bronze)}</td>
                  <td>
                    <strong>{formatNumber(athlete.totalQuantidade)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
