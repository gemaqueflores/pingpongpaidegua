"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { apiGetAthleteCareer } from "../../../../lib/user-api";
import { HeroTitle } from "../../../../components/ui/HeroTitle";
import { Card } from "../../../../components/ui/Card";
import { Badge } from "../../../../components/ui/Badge";
import { MatchCard } from "../../../../components/ui/MatchCard";
import { Skeleton } from "../../../../components/ui/Skeleton";
import { AthleteSummaryCard } from "../../../../components/career/AthleteSummaryCard";
import type { MedalMatrix } from "../../../../components/career/MedalMatrixTable";

type CareerMatch = {
  id: number;
  phase: string;
  round: string | null;
  tableNumber: string | null;
  matchDatetime: string | null;
  gameId: string | null;
  scoreRaw: string;
  scoreFinal: { setsA: number; setsB: number } | null;
  scoreSets: Array<{ set: number; a: number; b: number }>;
  sets: Array<{ p1: number; p2: number }>;
  setsResult: { p1Sets: number; p2Sets: number } | null;
  winnerIndex?: 0 | 1 | null;
  athleteIndex?: 0 | 1 | null;
  outcome: "W" | "L" | null;
  players: Array<{ id: number | null; name: string } | null>;
  category: { id: number; name: string };
  matchKey: string;
};

type MatchTone = "win" | "lose" | "neutral";

type CareerEvent = {
  id: number;
  cbtmEventId: number;
  nome: string;
  nivel: "ESTADUAL" | "COPA" | "NACIONAL" | "OPEN" | null;
  dataInicio: string | null;
  dataFim: string | null;
  concluido: boolean;
  categories: Array<{ id: number; name: string }>;
  matches: CareerMatch[];
  performance: {
    pointsWon: number;
    pointsPlayed: number;
    ratio: number | null;
  };
  performanceByCategory?: Array<{
    categoryId: number;
    categoryName: string;
    performance: {
      pointsWon: number;
      pointsPlayed: number;
      ratio: number | null;
      setsUsed: number;
      ignoredSets: number;
      matchesConsidered: number;
    };
    classification?: {
      position: number | null;
      reason: string;
      mode: "grupo_unico" | "eliminatoria" | "indefinido";
      tieTechnical: boolean;
    } | null;
  }>;
};

type CareerResponse = {
  athlete: {
    athleteKey: string;
    nameDisplay: string;
    nameReduced: string;
    stateCode?: string | null;
    stateName?: string | null;
    region?: string | null;
  };
  totals: {
    events: number;
    matches: number;
    performance: {
      pointsWon: number;
      pointsPlayed: number;
      ratio: number | null;
    };
  };
  medalTable?: {
    ESTADUAL: { bronze: number; prata: number; ouro: number };
    COPA: { bronze: number; prata: number; ouro: number };
    NACIONAL: { bronze: number; prata: number; ouro: number };
    OPEN: { bronze: number; prata: number; ouro: number };
  };
  events: CareerEvent[];
};

function formatDate(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("pt-BR");
}

function formatDatetime(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleString("pt-BR");
}

function formatRatio(ratio: number | null): string {
  if (ratio === null) return "-";
  return `${(ratio * 100).toFixed(2)}%`;
}

function formatAthleteFederation(input: {
  stateCode?: string | null;
  stateName?: string | null;
  region?: string | null;
}): string | null {
  if (!input.stateCode || !input.region) {
    return null;
  }
  return `${input.stateCode} (${input.stateName ?? "UF"}) - ${input.region}`;
}

function toReducedName(name: string | null | undefined): string {
  const tokens = String(name ?? "")
    .trim()
    .split(/\s+/g)
    .filter(Boolean);
  if (tokens.length === 0) return "-";
  if (tokens.length === 1) return tokens[0];
  return `${tokens[0]} ${tokens[tokens.length - 1]}`;
}

function formatSets(match: CareerMatch): string {
  if (match.scoreSets.length > 0) {
    return match.scoreSets.map((set) => `${set.a}-${set.b}`).join(" / ");
  }
  if (match.sets.length === 0) return "-";
  return match.sets.map((set) => `${set.p1}-${set.p2}`).join(" / ");
}

function formatFinalSets(match: CareerMatch): string {
  if (match.scoreFinal) return `${match.scoreFinal.setsA}-${match.scoreFinal.setsB}`;
  if (!match.setsResult) return match.scoreRaw || "-";
  return `${match.setsResult.p1Sets}-${match.setsResult.p2Sets}`;
}

function toTimestamp(value: string | null): number {
  if (!value) return 0;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function resolveMatchHierarchyScore(match: CareerMatch): number {
  const phase = `${match.phase ?? ""} ${match.round ?? ""}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();

  if (phase.includes("FINAL")) {
    if (phase.includes("SEMIFINAL")) return 5;
    if (phase.includes("QUART")) return 4;
    if (phase.includes("OITAV")) return 3;
    return 6;
  }

  if (phase.includes("ELIMINATORIA")) {
    if (phase.includes("FASE 64")) return 1;
    if (phase.includes("FASE 32")) return 2;
    if (phase.includes("FASE 16")) return 3;
    if (phase.includes("OITAV")) return 3;
    if (phase.includes("QUART")) return 4;
    if (phase.includes("SEMIFINAL")) return 5;
    return 3;
  }

  if (phase.includes("GRUPO") || phase.includes("RESULTADOS")) return 0;
  return 0;
}

function getEventLatestMatchTimestamp(event: CareerEvent): number {
  if (event.matches.length === 0) {
    return Math.max(toTimestamp(event.dataFim), toTimestamp(event.dataInicio));
  }
  return Math.max(...event.matches.map((match) => toTimestamp(match.matchDatetime)));
}

function resolveMatchTone(match: CareerMatch): MatchTone {
  if ((match.winnerIndex === 0 || match.winnerIndex === 1) && (match.athleteIndex === 0 || match.athleteIndex === 1)) {
    return match.winnerIndex === match.athleteIndex ? "win" : "lose";
  }

  if ((match.athleteIndex === 0 || match.athleteIndex === 1) && match.scoreFinal) {
    const athleteSets = match.athleteIndex === 0 ? match.scoreFinal.setsA : match.scoreFinal.setsB;
    const opponentSets = match.athleteIndex === 0 ? match.scoreFinal.setsB : match.scoreFinal.setsA;
    if (athleteSets > opponentSets) return "win";
    if (athleteSets < opponentSets) return "lose";
  }

  if ((match.athleteIndex === 0 || match.athleteIndex === 1) && match.setsResult) {
    const athleteSets = match.athleteIndex === 0 ? match.setsResult.p1Sets : match.setsResult.p2Sets;
    const opponentSets = match.athleteIndex === 0 ? match.setsResult.p2Sets : match.setsResult.p1Sets;
    if (athleteSets > opponentSets) return "win";
    if (athleteSets < opponentSets) return "lose";
  }

  if (match.outcome === "W") return "win";
  if (match.outcome === "L") return "lose";
  return "neutral";
}

function getClassificationRowClass(position: number | null | undefined): string {
  if (position === 1) return "classification-row-ouro";
  if (position === 2) return "classification-row-prata";
  if (position === 3) return "classification-row-bronze";
  return "classification-row-default";
}

function normalizeCompetitionKey(level: CareerEvent["nivel"]): "estadual" | "copa" | "brasileirao" | "open" {
  if (level === "ESTADUAL") return "estadual";
  if (level === "COPA") return "copa";
  if (level === "OPEN") return "open";
  return "brasileirao";
}

function emptyMatrix(): MedalMatrix {
  return {
    ouro: { estadual: 0, copa: 0, brasileirao: 0, open: 0, total: 0 },
    prata: { estadual: 0, copa: 0, brasileirao: 0, open: 0, total: 0 },
    bronze: { estadual: 0, copa: 0, brasileirao: 0, open: 0, total: 0 },
  };
}

function applyMatrixTotals(matrix: MedalMatrix): MedalMatrix {
  return {
    ouro: { ...matrix.ouro, total: matrix.ouro.estadual + matrix.ouro.copa + matrix.ouro.brasileirao + matrix.ouro.open },
    prata: { ...matrix.prata, total: matrix.prata.estadual + matrix.prata.copa + matrix.prata.brasileirao + matrix.prata.open },
    bronze: { ...matrix.bronze, total: matrix.bronze.estadual + matrix.bronze.copa + matrix.bronze.brasileirao + matrix.bronze.open },
  };
}

function computeMedalsByCompetition(events: CareerEvent[], fallback?: CareerResponse["medalTable"]): MedalMatrix {
  const matrix = emptyMatrix();
  let classificationsCount = 0;

  for (const event of events) {
    const competition = normalizeCompetitionKey(event.nivel);
    const categories = event.performanceByCategory ?? [];
    for (const category of categories) {
      const pos = category.classification?.position;
      if (!pos) continue;
      classificationsCount += 1;
      if (pos === 1) matrix.ouro[competition] += 1;
      if (pos === 2) matrix.prata[competition] += 1;
      if (pos === 3) matrix.bronze[competition] += 1;
    }
  }

  if (classificationsCount === 0 && fallback) {
    matrix.ouro.estadual = fallback.ESTADUAL?.ouro ?? 0;
    matrix.ouro.copa = fallback.COPA?.ouro ?? 0;
    matrix.ouro.brasileirao = fallback.NACIONAL?.ouro ?? 0;
    matrix.ouro.open = fallback.OPEN?.ouro ?? 0;

    matrix.prata.estadual = fallback.ESTADUAL?.prata ?? 0;
    matrix.prata.copa = fallback.COPA?.prata ?? 0;
    matrix.prata.brasileirao = fallback.NACIONAL?.prata ?? 0;
    matrix.prata.open = fallback.OPEN?.prata ?? 0;

    matrix.bronze.estadual = fallback.ESTADUAL?.bronze ?? 0;
    matrix.bronze.copa = fallback.COPA?.bronze ?? 0;
    matrix.bronze.brasileirao = fallback.NACIONAL?.bronze ?? 0;
    matrix.bronze.open = fallback.OPEN?.bronze ?? 0;
  }

  return applyMatrixTotals(matrix);
}

export default function AthleteCareerPage() {
  const params = useParams<{ athleteKey: string }>();
  const athleteKey = decodeURIComponent(params.athleteKey);
  const [payload, setPayload] = useState<CareerResponse | null>(null);

  useEffect(() => {
    void apiGetAthleteCareer(athleteKey).then((data) => setPayload(data as CareerResponse));
  }, [athleteKey]);

  const summaryStats = useMemo(() => {
    if (!payload) return null;

    const matches = payload.events
      .flatMap((event) => event.matches)
      .slice()
      .sort((left, right) => toTimestamp(right.matchDatetime) - toTimestamp(left.matchDatetime));

    const tones = matches.map((match) => resolveMatchTone(match));
    const wins = tones.filter((tone) => tone === "win").length;
    const losses = tones.filter((tone) => tone === "lose").length;
    const recent = tones.slice(0, 5).map((tone) => (tone === "win" ? "W" : tone === "lose" ? "L" : "-"));

    return { wins, losses, recent };
  }, [payload]);

  const sortedEvents = useMemo(() => {
    if (!payload) return [] as CareerEvent[];

    return [...payload.events].sort((left, right) => {
      const leftTs = getEventLatestMatchTimestamp(left);
      const rightTs = getEventLatestMatchTimestamp(right);
      if (leftTs !== rightTs) return rightTs - leftTs;
      return right.nome.localeCompare(left.nome, "pt-BR", { sensitivity: "base" });
    });
  }, [payload]);

  const medalMatrix = useMemo(() => {
    if (!payload) return emptyMatrix();
    return computeMedalsByCompetition(payload.events, payload.medalTable);
  }, [payload]);

  const federationText = payload ? formatAthleteFederation(payload.athlete) : null;

  const shareColumns: Array<{ key: "estadual" | "copa" | "brasileirao" | "open" | "total"; label: string }> = [
    { key: "estadual", label: "Estadual" },
    { key: "copa", label: "Copa" },
    { key: "brasileirao", label: "Brasileirão" },
    { key: "open", label: "Open" },
    { key: "total", label: "Total" },
  ];

  return (
    <main className="container grid user-page">
      <HeroTitle
        title="Carreira"
        subtitle="Tênis de Mesa / Table Tennis"
        actions={
          <button type="button" onClick={() => (window.location.href = "/")}>Voltar para home</button>
        }
      />

      {!payload ? (
        <Card className="grid">
          <Skeleton height="24px" width="260px" />
          <Skeleton height="20px" />
          <Skeleton height="20px" />
          <Skeleton height="20px" />
        </Card>
      ) : (
        <>
          <AthleteSummaryCard
            athleteName={payload.athlete.nameDisplay}
            athleteReducedName={payload.athlete.nameReduced}
            federationText={federationText ?? undefined}
            kpis={{
              ratio: formatRatio(payload.totals.performance.ratio),
              pointsDetail: `${payload.totals.performance.pointsWon}/${payload.totals.performance.pointsPlayed}`,
              wins: summaryStats?.wins ?? 0,
              losses: summaryStats?.losses ?? 0,
              recent: summaryStats?.recent.join(" ") || "-",
              totalEvents: payload.totals.events,
              totalMatches: payload.totals.matches,
            }}
            medalMatrix={medalMatrix}
            share={{
              athleteKey: payload.athlete.athleteKey,
              stateCode: payload.athlete.stateCode,
              visibleColumns: shareColumns,
            }}
          />

          <Card className="grid">
            <h2>Eventos disputados</h2>
            {sortedEvents.length === 0 ? <p>Nenhum evento encontrado.</p> : null}

            {sortedEvents.map((event, eventIndex) => {
              const sortedCategoryPerformance = [...(event.performanceByCategory ?? [])].sort((left, right) => {
                const leftPosition = left.classification?.position ?? Number.MAX_SAFE_INTEGER;
                const rightPosition = right.classification?.position ?? Number.MAX_SAFE_INTEGER;
                if (leftPosition !== rightPosition) return leftPosition - rightPosition;
                const leftRatio = left.performance.ratio ?? -1;
                const rightRatio = right.performance.ratio ?? -1;
                if (leftRatio !== rightRatio) return rightRatio - leftRatio;
                return left.categoryName.localeCompare(right.categoryName, "pt-BR", { sensitivity: "base" });
              });

              const sortedMatches = [...event.matches].sort((left, right) => {
                const tsDiff = toTimestamp(right.matchDatetime) - toTimestamp(left.matchDatetime);
                if (tsDiff !== 0) return tsDiff;
                const hierarchyDiff = resolveMatchHierarchyScore(right) - resolveMatchHierarchyScore(left);
                if (hierarchyDiff !== 0) return hierarchyDiff;
                return right.category.name.localeCompare(left.category.name, "pt-BR", { sensitivity: "base" });
              });

              return (
                <div key={event.id} className="match-group career-event-card">
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <h3 className="match-group-title">{event.nome}</h3>
                    <div className="row">
                      <Badge tone="default">{event.nivel ?? "Evento"}</Badge>
                      <Badge tone={event.concluido ? "done" : "open"}>{event.concluido ? "Concluído" : "Em andamento"}</Badge>
                    </div>
                  </div>

                  <p>CBTM: <strong>{event.cbtmEventId}</strong> | Período: {formatDate(event.dataInicio)} até {formatDate(event.dataFim)}</p>
                  <p>Categorias: {event.categories.map((category) => category.name).join(", ") || "-"}</p>

                  <div>
                    <strong>Aproveitamento do evento e por categoria</strong>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Categoria</th>
                          <th>Aproveitamento</th>
                          <th>Classificação</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="classification-row-default">
                          <td><strong>Total do evento</strong></td>
                          <td><strong>{formatRatio(event.performance.ratio)} ({event.performance.pointsWon}/{event.performance.pointsPlayed})</strong></td>
                          <td><strong>-</strong></td>
                        </tr>
                        {sortedCategoryPerformance.map((item) => (
                          <tr key={`${event.id}-${item.categoryId}`} className={getClassificationRowClass(item.classification?.position)}>
                            <td>{item.categoryName}</td>
                            <td>{formatRatio(item.performance.ratio)} ({item.performance.pointsWon}/{item.performance.pointsPlayed})</td>
                            <td>{item.classification?.position ? `${item.classification.position}º` : "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <details className="career-event-matches" open={eventIndex === 0}>
                    <summary>Jogos do evento ({sortedMatches.length})</summary>
                    <div className="match-card-grid">
                      {sortedMatches.map((match) => {
                        const tone = resolveMatchTone(match);
                        return (
                          <MatchCard
                            key={match.matchKey}
                            categoryName={match.category.name}
                            phase={match.phase}
                            round={match.round ?? "-"}
                            datetime={formatDatetime(match.matchDatetime)}
                            confrontation={`${toReducedName(match.players[0]?.name)} x ${toReducedName(match.players[1]?.name)}`}
                            setsLine={formatSets(match)}
                            finalLine={formatFinalSets(match)}
                            tone={tone}
                          />
                        );
                      })}
                    </div>
                  </details>
                </div>
              );
            })}
          </Card>
        </>
      )}
    </main>
  );
}
