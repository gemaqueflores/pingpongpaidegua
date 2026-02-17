import React from "react";
import { Card } from "../ui/Card";
import { PerformanceBar } from "../ui/PerformanceBar";
import type { MedalMatrix } from "./MedalMatrixTable";

type AthleteSummaryCardProps = {
  athleteName: string;
  athleteReducedName: string;
  federationText?: string;
  clubName?: string;
  nextEventName?: string | null;
  kpis: {
    ratio: string;
    pointsDetail: string;
    wins: number;
    losses: number;
    recent: string;
    totalEvents: number;
    totalMatches: number;
  };
  medalMatrix: MedalMatrix;
};

export function AthleteSummaryCard({
  athleteName,
  athleteReducedName,
  federationText,
  clubName,
  nextEventName,
  kpis,
  medalMatrix,
}: AthleteSummaryCardProps) {
  const ratioNumeric = Number.parseFloat(kpis.ratio.replace("%", "").replace(",", "."));
  const ratioPercent = Number.isFinite(ratioNumeric) ? ratioNumeric : null;

  const totalMatchesSafe = Math.max(kpis.totalMatches, 1);
  const winsPercent = Math.max(0, Math.min(100, (kpis.wins / totalMatchesSafe) * 100));
  const lossesPercent = Math.max(0, Math.min(100, (kpis.losses / totalMatchesSafe) * 100));

  const medalBars = [
    { label: "Ouro", value: medalMatrix.ouro.total, className: "gold" },
    { label: "Prata", value: medalMatrix.prata.total, className: "silver" },
    { label: "Bronze", value: medalMatrix.bronze.total, className: "bronze" },
  ] as const;
  const maxMedal = Math.max(...medalBars.map((item) => item.value), 1);

  return (
    <Card className="grid athlete-summary-card" variant="athlete">
      <div>
        <h2>{athleteName}</h2>
        <p className="arena-muted" style={{ margin: "2px 0" }}>
          <strong>{athleteReducedName || "-"}</strong>
        </p>
        <p className="arena-muted" style={{ margin: "2px 0" }}>
          <strong>{clubName ?? "-"}</strong>
        </p>
        {federationText ? (
          <p className="arena-muted" style={{ margin: "2px 0" }}>
            <strong>{federationText}</strong>
          </p>
        ) : null}
      </div>

      <div className="career-summary-bars">
        <div className="career-summary-bar-block">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>Aproveitamento da carreira</strong>
            <strong>{kpis.ratio}</strong>
          </div>
          <PerformanceBar percent={ratioPercent} />
          <p className="arena-muted" style={{ margin: 0 }}>{kpis.pointsDetail} pontos</p>
        </div>

        <div className="career-summary-bar-block">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>Vitórias / Derrotas</strong>
            <strong>{kpis.wins}/{kpis.losses}</strong>
          </div>
          <div className="career-wl-track" aria-label="Proporção de vitórias e derrotas">
            <div className="career-wl-fill-win" style={{ width: `${winsPercent}%` }} />
            <div className="career-wl-fill-loss" style={{ width: `${lossesPercent}%` }} />
          </div>
          <p className="arena-muted" style={{ margin: 0 }}>Total de confrontos: {kpis.totalMatches}</p>
        </div>
      </div>

      <div className="career-kpi-pair">
        <article className="career-kpi-card">
          <small>Últimos 5</small>
          <strong>{kpis.recent || "-"}</strong>
          <span className="arena-muted">V = vitória | D = derrota</span>
        </article>
        <article className="career-kpi-card">
          <small>Total de competições</small>
          <strong>{kpis.totalEvents}</strong>
        </article>
      </div>

      <div className="career-medal-bars">
        {medalBars.map((item) => {
          const widthPercent = Math.round((item.value / maxMedal) * 100);
          return (
            <div key={item.label} className="career-medal-bar-row">
              <span className="career-medal-bar-label">{item.label}</span>
              <div className="career-medal-bar-track">
                <div className={`career-medal-bar-fill ${item.className}`} style={{ width: `${Math.max(widthPercent, item.value > 0 ? 6 : 0)}%` }} />
              </div>
              <strong>{item.value}</strong>
            </div>
          );
        })}
      </div>

      <div className="row" style={{ justifyContent: "flex-start" }}>
        <span className="ui-badge ui-badge-default">Próximo evento: {nextEventName ?? "-"}</span>
      </div>
    </Card>
  );
}


