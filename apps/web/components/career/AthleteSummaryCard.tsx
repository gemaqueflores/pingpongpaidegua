import React from "react";
import { ShareActions } from "../share/ShareActions";
import { createShareImageBlob } from "../../lib/share-image";
import { Card } from "../ui/Card";
import { StatBlock } from "../ui/StatBlock";
import type { MedalMatrix } from "./MedalMatrixTable";
import { MedalMatrixTable } from "./MedalMatrixTable";

type AthleteSummaryCardProps = {
  athleteName: string;
  athleteReducedName: string;
  federationText?: string;
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
  share: {
    athleteKey: string;
    stateCode?: string | null;
    visibleColumns: Array<{ key: "estadual" | "copa" | "brasileirao" | "open" | "total"; label: string }>;
  };
};

export function AthleteSummaryCard({
  athleteName,
  athleteReducedName,
  federationText,
  kpis,
  medalMatrix,
  share,
}: AthleteSummaryCardProps) {
  return (
    <Card className="grid athlete-summary-card" variant="athlete">
      <div className="athlete-summary-head">
        <div>
          <h2>{athleteName}</h2>
          {federationText ? <p className="arena-muted">UF/Região: <strong>{federationText}</strong></p> : null}
          <p className="arena-muted">Nome reduzido: <strong>{athleteReducedName || "-"}</strong></p>
        </div>
        <ShareActions
          inline
          iconOnly
          shareText={`Confira a carreira de ${athleteReducedName || athleteName}`}
          fileName={`carreira-${share.athleteKey}.png`}
          buildImage={() =>
            createShareImageBlob({
              title: athleteName,
              subtitle: "Tênis de Mesa / Table Tennis",
              subtitleSecondary: "Carreira",
              lines: [],
              metrics: [
                { label: "UF", value: share.stateCode ?? "-" },
                { label: "Pontos disputados", value: kpis.pointsDetail.split("/")[1] ?? "0" },
                { label: "Pontos conquistados", value: kpis.pointsDetail.split("/")[0] ?? "0" },
                { label: "Eficiência", value: kpis.ratio },
              ],
              medalTable: {
                title: "",
                columns: share.visibleColumns.map((column) => ({ key: column.key, label: column.label })),
                rows: [
                  {
                    medalType: "ouro",
                    label: "Ouro",
                    values: share.visibleColumns.map((column) => medalMatrix.ouro[column.key]),
                  },
                  {
                    medalType: "prata",
                    label: "Prata",
                    values: share.visibleColumns.map((column) => medalMatrix.prata[column.key]),
                  },
                  {
                    medalType: "bronze",
                    label: "Bronze",
                    values: share.visibleColumns.map((column) => medalMatrix.bronze[column.key]),
                  },
                ],
              },
              footer: "Fonte: PingPong Paid'egua",
            })
          }
        />
      </div>

      <div className="career-hero-stats">
        <StatBlock label="Aproveitamento" value={kpis.ratio} hint={`${kpis.pointsDetail} pontos`} />
        <StatBlock label="Vitórias" value={String(kpis.wins)} tone="win" />
        <StatBlock label="Derrotas" value={String(kpis.losses)} tone="loss" />
        <StatBlock label="Últimos 5" value={kpis.recent || "-"} />
        <StatBlock label="Eventos" value={String(kpis.totalEvents)} />
        <StatBlock label="Jogos" value={String(kpis.totalMatches)} />
      </div>

      <MedalMatrixTable matrix={medalMatrix} />
    </Card>
  );
}
