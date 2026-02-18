"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { apiGetAthleteSummary } from "../../../../../../lib/user-api";
import { Card } from "../../../../../../components/ui/Card";
import { MatchCard } from "../../../../../../components/ui/MatchCard";
import { Skeleton } from "../../../../../../components/ui/Skeleton";
import { PerformanceBar } from "../../../../../../components/ui/PerformanceBar";
import { PageHeader } from "../../../../../../components/ui/PageHeader";
import { SegmentedControl } from "../../../../../../components/ui/SegmentedControl";
import { DataTableResponsive } from "../../../../../../components/ui/DataTableResponsive";

type GroupMode = "category" | "schedule";

type SummaryMatch = {
  id: number;
  phase: string;
  round: string | null;
  tableNumber: string | null;
  matchDatetime: string | null;
  scoreRaw: string;
  scoreFinal: { setsA: number; setsB: number } | null;
  scoreSets: Array<{ set: number; a: number; b: number }>;
  gameId: string | null;
  sets: Array<{ p1: number; p2: number }>;
  setsResult: { p1Sets: number; p2Sets: number } | null;
  winnerIndex: 0 | 1 | null;
  athleteIndex: 0 | 1 | null;
  outcome: "W" | "L" | null;
  players: Array<{ id: number | null; name: string } | null>;
  category: {
    id: number;
    name: string;
  };
  opponent?: {
    id: number;
    name: string;
  } | null;
  matchKey: string;
};

type SummaryResponse = {
  athlete: {
    id: number;
    name: string;
    athleteKey: string;
    shortName: string;
    stateCode?: string | null;
    stateName?: string | null;
    region?: string | null;
  };
  club: { id: number; name: string };
  categories: Array<{ id: number; name: string }>;
  matches: SummaryMatch[];
  performance: {
    pointsWon: number;
    pointsPlayed: number;
    ratio: number | null;
    setsUsed: number;
    ignoredSets: number;
    matchesConsidered: number;
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
  noDatetimeFallback: string;
  deduplicatedMatchesRemoved?: number;
};

type MatchGroup = {
  id: string;
  title: string;
  matches: SummaryMatch[];
};

type MatchTone = "win" | "lose" | "neutral";

function formatDayLabel(value: string | null): string {
  if (!value) {
    return "Sem data definida";
  }
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Belem",
  }).format(new Date(value));
}

function formatDatetime(value: string | null): string {
  if (!value) {
    return "-";
  }
  const parts = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Belem",
  }).formatToParts(new Date(value));

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00";

  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")}`;
}

function formatScoreSets(match: SummaryMatch): string | null {
  if (match.scoreSets.length > 0) {
    return match.scoreSets.map((set) => `${set.a}-${set.b}`).join(", ");
  }

  if (match.sets.length > 0) {
    return match.sets.map((set) => `${set.p1}-${set.p2}`).join(", ");
  }

  return null;
}

function toReducedName(name: string | null | undefined): string {
  const tokens = String(name ?? "")
    .trim()
    .split(/\s+/g)
    .filter(Boolean);

  if (tokens.length === 0) {
    return "-";
  }
  if (tokens.length === 1) {
    return tokens[0];
  }

  return `${tokens[0]} ${tokens[tokens.length - 1]}`;
}

function formatFinalSets(match: SummaryMatch): string {
  if (match.scoreFinal) {
    return `${match.scoreFinal.setsA}-${match.scoreFinal.setsB}`;
  }
  if (match.setsResult) {
    return `${match.setsResult.p1Sets}-${match.setsResult.p2Sets}`;
  }
  return match.scoreRaw || "-";
}

function formatRatio(ratio: number | null): string {
  if (ratio === null) {
    return "-";
  }
  return `${(ratio * 100).toFixed(2)}%`;
}

function formatAthleteFederation(input: {
  stateCode?: string | null;
  stateName?: string | null;
  region?: string | null;
}): string {
  if (!input.stateCode || !input.region) {
    return "-";
  }
  return `${input.stateCode} (${input.stateName ?? "UF"}) - ${input.region}`;
}

function resolveMatchTone(match: SummaryMatch): MatchTone {
  if ((match.winnerIndex === 0 || match.winnerIndex === 1) && (match.athleteIndex === 0 || match.athleteIndex === 1)) {
    if (match.winnerIndex === match.athleteIndex) {
      return "win";
    }
    return "lose";
  }

  if (match.outcome === "W") {
    return "win";
  }
  if (match.outcome === "L") {
    return "lose";
  }

  return "neutral";
}

function summarizeSetStats(match: SummaryMatch): { won: number; played: number } {
  if (match.athleteIndex !== 0 && match.athleteIndex !== 1) return { won: 0, played: 0 };

  if (match.scoreFinal) {
    const athleteWon = match.athleteIndex === 0 ? match.scoreFinal.setsA : match.scoreFinal.setsB;
    const opponentWon = match.athleteIndex === 0 ? match.scoreFinal.setsB : match.scoreFinal.setsA;
    return { won: athleteWon, played: athleteWon + opponentWon };
  }

  if (match.setsResult) {
    const athleteWon = match.athleteIndex === 0 ? match.setsResult.p1Sets : match.setsResult.p2Sets;
    const opponentWon = match.athleteIndex === 0 ? match.setsResult.p2Sets : match.setsResult.p1Sets;
    return { won: athleteWon, played: athleteWon + opponentWon };
  }

  const sourceSets =
    match.scoreSets.length > 0
      ? match.scoreSets.map((set) => ({ a: set.a, b: set.b }))
      : match.sets.map((set) => ({ a: set.p1, b: set.p2 }));

  if (sourceSets.length === 0) return { won: 0, played: 0 };

  let won = 0;
  for (const set of sourceSets) {
    const athletePoints = match.athleteIndex === 0 ? set.a : set.b;
    const opponentPoints = match.athleteIndex === 0 ? set.b : set.a;
    if (athletePoints > opponentPoints) won += 1;
  }
  return { won, played: sourceSets.length };
}

export default function AthleteSummaryPage() {
  const params = useParams<{ id: string; athleteId: string }>();
  const eventId = Number(params.id);
  const athleteId = Number(params.athleteId);

  const [groupMode, setGroupMode] = useState<GroupMode>("category");
  const [summary, setSummary] = useState<SummaryResponse | null>(null);

  const orderBy = groupMode === "category" ? "category_phase_datetime" : "phase_hierarchy_datetime";

  useEffect(() => {
    void apiGetAthleteSummary(eventId, athleteId, orderBy).then((payload) => setSummary(payload as SummaryResponse));
  }, [eventId, athleteId, orderBy]);

  const groups = useMemo<MatchGroup[]>(() => {
    const matches = summary?.matches ?? [];
    if (matches.length === 0) {
      return [];
    }

    if (groupMode === "category") {
      const map = new Map<string, MatchGroup>();
      for (const match of matches) {
        const key = String(match.category.id);
        const existing = map.get(key);
        if (existing) {
          existing.matches.push(match);
          continue;
        }

        map.set(key, {
          id: key,
          title: match.category.name,
          matches: [match],
        });
      }

      return [...map.values()];
    }

    const map = new Map<string, MatchGroup>();
    for (const match of matches) {
      const dayKey = match.matchDatetime ? new Date(match.matchDatetime).toISOString().slice(0, 10) : "sem-data";
      const existing = map.get(dayKey);
      if (existing) {
        existing.matches.push(match);
        continue;
      }

      map.set(dayKey, {
        id: dayKey,
        title: dayKey === "sem-data" ? "Sem data definida" : formatDayLabel(match.matchDatetime),
        matches: [match],
      });
    }

    return [...map.entries()]
      .sort((a, b) => {
        if (a[0] === "sem-data") {
          return 1;
        }
        if (b[0] === "sem-data") {
          return -1;
        }
        return a[0].localeCompare(b[0]);
      })
      .map((entry) => entry[1]);
  }, [summary, groupMode]);

  const athleteStats = useMemo(() => {
    if (!summary) {
      return {
        totalVitorias: 0,
        totalConfrontos: 0,
        setsGanhos: 0,
        setsDisputados: 0,
        pontosGanhos: 0,
        pontosDisputados: 0,
      };
    }

    let totalVitorias = 0;
    let setsGanhos = 0;
    let setsDisputados = 0;

    for (const match of summary.matches) {
      const tone = resolveMatchTone(match);
      if (tone === "win") totalVitorias += 1;
      const sets = summarizeSetStats(match);
      setsGanhos += sets.won;
      setsDisputados += sets.played;
    }

    return {
      totalVitorias,
      totalConfrontos: summary.matches.length,
      setsGanhos,
      setsDisputados,
      pontosGanhos: summary.performance.pointsWon,
      pontosDisputados: summary.performance.pointsPlayed,
    };
  }, [summary]);

  return (
    <main className="container grid user-page">
      <PageHeader
        title="Resumo do Atleta"
        subtitle="Tênis de Mesa / Table Tennis"
        compact
        actions={
          <button type="button" className="event-back-button" onClick={() => (window.location.href = `/events/${eventId}`)}>
            ← Voltar
          </button>
        }
      />

      {!summary ? (
        <Card className="grid">
          <Skeleton height="24px" width="260px" />
          <Skeleton height="20px" />
          <Skeleton height="20px" />
          <Skeleton height="20px" />
        </Card>
      ) : (
        <>
          <Card className="grid">
            <h2>{summary.athlete.name}</h2>
            <p>
              Nome reduzido: <strong>{summary.athlete.shortName || "-"}</strong>
            </p>
            <p>
              Clube: <strong>{summary.club.name}</strong>
            </p>
            <p>
              UF/Regiao: <strong>{formatAthleteFederation(summary.athlete)}</strong>
            </p>
            <p>
              Categorias: {summary.categories.map((category) => category.name).join(", ") || "-"}
            </p>
            <p>
              Aproveitamento por pontos: <strong>{formatRatio(summary.performance.ratio)}</strong> (
              {summary.performance.pointsWon}/{summary.performance.pointsPlayed})
            </p>
            <PerformanceBar percent={summary.performance.ratio === null ? null : summary.performance.ratio * 100} />
            <div className="event-athlete-stats-grid">
              <span><small>Vitórias</small><strong>{athleteStats.totalVitorias}</strong></span>
              <span><small>Confrontos</small><strong>{athleteStats.totalConfrontos}</strong></span>
              <span><small>Sets ganhos</small><strong>{athleteStats.setsGanhos}</strong></span>
              <span><small>Sets disputados</small><strong>{athleteStats.setsDisputados}</strong></span>
              <span><small>Pontos ganhos</small><strong>{athleteStats.pontosGanhos}</strong></span>
              <span><small>Pontos disputados</small><strong>{athleteStats.pontosDisputados}</strong></span>
            </div>
            <div>
              <strong>Aproveitamento por categoria</strong>
              {summary.performanceByCategory && summary.performanceByCategory.length > 0 ? (
                <DataTableResponsive
                  rows={summary.performanceByCategory}
                  empty={<p className="arena-muted">Sem dados de aproveitamento por categoria.</p>}
                  columns={[
                    { key: "categoria", header: "Categoria", render: (item) => item.categoryName },
                    {
                      key: "aproveitamento",
                      header: "Aproveitamento",
                      render: (item) => `${formatRatio(item.performance.ratio)} (${item.performance.pointsWon}/${item.performance.pointsPlayed})`,
                    },
                    {
                      key: "classificacao",
                      header: "Classificação",
                      render: (item) => (item.classification?.position ? `${item.classification.position}º` : "-"),
                    },
                  ]}
                  mobileCard={(item) => (
                    <article key={item.categoryId} className="athlete-list-card">
                      <strong>{item.categoryName}</strong>
                      <p style={{ margin: 0 }}>
                        Aproveitamento {formatRatio(item.performance.ratio)} ({item.performance.pointsWon}/{item.performance.pointsPlayed})
                      </p>
                      <p className="arena-muted" style={{ margin: 0 }}>
                        Classificação {item.classification?.position ? `${item.classification.position}º` : "-"}
                      </p>
                    </article>
                  )}
                />
              ) : (
                <p>-</p>
              )}
            </div>
            <div>
              <a className="event-athlete-secondary-link" href={`/career/${encodeURIComponent(summary.athlete.athleteKey)}`}>
                Abrir carreira
              </a>
            </div>
          </Card>

          <Card className="grid">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2>Jogos</h2>
              <SegmentedControl
                label="Agrupar jogos"
                value={groupMode}
                onChange={(next) => setGroupMode(next as GroupMode)}
                items={[
                  { value: "category", label: "Por categoria" },
                  { value: "schedule", label: "Por horário" },
                ]}
              />
            </div>

            <p>{summary.noDatetimeFallback}</p>

            {groups.length === 0 ? <p>Nenhum jogo encontrado para este atleta.</p> : null}

            {groups.map((group) => (
              <div key={group.id} className="match-group">
                <h3 className="match-group-title">{group.title}</h3>
                <div className="match-card-grid">
                  {group.matches.map((match) => {
                    const scoreSetsLabel = formatScoreSets(match);
                    const tone = resolveMatchTone(match);
                    return (
                      <MatchCard
                        key={match.matchKey}
                        categoryName={groupMode === "schedule" ? match.category.name : group.title}
                        phase={match.phase}
                        round={`${match.round ?? "-"} | Mesa ${match.tableNumber ?? "-"}`}
                        datetime={formatDatetime(match.matchDatetime)}
                        confrontation={`${toReducedName(match.players[0]?.name)} x ${toReducedName(match.players[1]?.name)}`}
                        setsLine={scoreSetsLabel || "-"}
                        finalLine={formatFinalSets(match)}
                        tone={tone}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </Card>
        </>
      )}
    </main>
  );
}


