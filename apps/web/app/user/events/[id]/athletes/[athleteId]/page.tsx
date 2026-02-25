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

type SortMode = "recent" | "oldest";

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
  event: {
    id: number;
    name: string;
  };
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

function hasMatchResult(match: SummaryMatch): boolean {
  if (match.scoreFinal || match.setsResult) {
    return true;
  }
  if (match.scoreSets.length > 0 || match.sets.length > 0) {
    return true;
  }

  const raw = String(match.scoreRaw ?? "").trim();
  if (!raw || raw === "-") {
    return false;
  }
  if (/wo/i.test(raw)) {
    return true;
  }
  return /\d+\s*[-xX]\s*\d+/.test(raw);
}

function resolveGameOrderId(match: SummaryMatch): number {
  const direct = String(match.gameId ?? "").match(/\d+/)?.[0];
  if (direct) {
    return Number(direct);
  }

  const roundHint = String(match.round ?? "").match(/\b(?:jogo|fase|rodada)\s*0*(\d+)\b/i)?.[1];
  if (roundHint) {
    return Number(roundHint);
  }

  return match.id;
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

function parseRoundLabel(round: string | null): string {
  const normalized = String(round ?? "").trim();
  if (!normalized) {
    return "-";
  }
  const normalizedKey = normalized
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (normalizedKey === "unico 01" || normalizedKey === "unica 01" || normalizedKey === "grupo unico 01") {
    return "Grupo Único";
  }
  return normalized;
}

function resolveScoreSets(match: SummaryMatch): Array<{ a: number; b: number }> {
  if (match.scoreSets.length > 0) {
    return match.scoreSets.map((set) => ({ a: Number(set.a), b: Number(set.b) }));
  }
  if (match.sets.length > 0) {
    return match.sets.map((set) => ({ a: Number(set.p1), b: Number(set.p2) }));
  }
  return [];
}

function resolveSetsResult(match: SummaryMatch): { p1Sets: number; p2Sets: number } | null {
  if (match.scoreFinal) {
    return { p1Sets: match.scoreFinal.setsA, p2Sets: match.scoreFinal.setsB };
  }
  if (match.setsResult) {
    return { p1Sets: match.setsResult.p1Sets, p2Sets: match.setsResult.p2Sets };
  }
  return null;
}

function isWalkoverMatch(match: SummaryMatch): boolean {
  const raw = String(match.scoreRaw ?? "")
    .trim()
    .toLowerCase();
  if (raw.includes("wo")) {
    return true;
  }

  const sets = resolveScoreSets(match);
  const setsResult = resolveSetsResult(match);

  const isDoubleWalkover =
    sets.length > 0 &&
    sets.every((set) => set.a === 0 && set.b === 0) &&
    Boolean(setsResult) &&
    (setsResult?.p1Sets ?? -1) === 0 &&
    (setsResult?.p2Sets ?? -1) === 0;
  if (isDoubleWalkover) {
    return true;
  }

  if (!setsResult) {
    return false;
  }

  const isStraightWin =
    (setsResult.p1Sets === 3 && setsResult.p2Sets === 0) ||
    (setsResult.p1Sets === 0 && setsResult.p2Sets === 3);
  if (!isStraightWin || sets.length !== 3) {
    return false;
  }

  const winnerIndex = match.winnerIndex;
  if (winnerIndex !== 0 && winnerIndex !== 1) {
    return false;
  }
  const winnerIsP1 = winnerIndex === 0;
  return sets.every((set) => (winnerIsP1 ? set.a === 11 && set.b === 0 : set.b === 11 && set.a === 0));
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
}): string | null {
  if (!input.stateCode || !input.region) {
    return null;
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

  const [separateByCategory, setSeparateByCategory] = useState<boolean>(true);
  const [sortMode, setSortMode] = useState<SortMode>("recent");
  const [summary, setSummary] = useState<SummaryResponse | null>(null);

  useEffect(() => {
    void apiGetAthleteSummary(eventId, athleteId, "phase_hierarchy_datetime").then((payload) =>
      setSummary(payload as SummaryResponse),
    );
  }, [eventId, athleteId]);

  const groups = useMemo<MatchGroup[]>(() => {
    const baseMatches = summary?.matches ?? [];
    const matches = [...baseMatches].sort((left, right) => {
      const leftHasResult = hasMatchResult(left);
      const rightHasResult = hasMatchResult(right);
      if (leftHasResult !== rightHasResult) {
        return leftHasResult ? 1 : -1;
      }

      const leftGameId = resolveGameOrderId(left);
      const rightGameId = resolveGameOrderId(right);
      if (leftGameId !== rightGameId) {
        return sortMode === "recent" ? rightGameId - leftGameId : leftGameId - rightGameId;
      }

      return sortMode === "recent" ? right.id - left.id : left.id - right.id;
    });

    if (matches.length === 0) {
      return [];
    }

    if (separateByCategory) {
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

      return [...map.values()].sort((left, right) =>
        left.title.localeCompare(right.title, "pt-BR", { sensitivity: "base" }),
      );
    }

    return [
      {
        id: "all-matches",
        title: "Todos os jogos",
        matches,
      },
    ];
  }, [separateByCategory, sortMode, summary]);

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
      if (isWalkoverMatch(match)) {
        continue;
      }
      const sets = summarizeSetStats(match);
      setsGanhos += sets.won;
      setsDisputados += sets.played;
    }

    let pontosGanhos = 0;
    let pontosDisputados = 0;
    for (const match of summary.matches) {
      if (isWalkoverMatch(match)) {
        continue;
      }
      if (match.athleteIndex !== 0 && match.athleteIndex !== 1) {
        continue;
      }
      for (const set of resolveScoreSets(match)) {
        if (!Number.isFinite(set.a) || !Number.isFinite(set.b)) {
          continue;
        }
        if (set.a < 0 || set.b < 0) {
          continue;
        }
        const athletePoints = match.athleteIndex === 0 ? set.a : set.b;
        const opponentPoints = match.athleteIndex === 0 ? set.b : set.a;
        pontosGanhos += athletePoints;
        pontosDisputados += athletePoints + opponentPoints;
      }
    }

    return {
      totalVitorias,
      totalConfrontos: summary.matches.length,
      setsGanhos,
      setsDisputados,
      pontosGanhos,
      pontosDisputados,
    };
  }, [summary]);

  return (
    <main className="container grid user-page">
      <PageHeader
        title="Resumo do Atleta"
        subtitle={summary?.event.name ?? "Evento"}
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
              Clube: <strong>{summary.club.name}</strong>
            </p>
            {formatAthleteFederation(summary.athlete) ? (
              <p>
                UF/Região: <strong>{formatAthleteFederation(summary.athlete)}</strong>
              </p>
            ) : null}
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
              <a className="event-athlete-secondary-link" href={`/career/${encodeURIComponent(summary.athlete.athleteKey)}`}>
                Abrir carreira
              </a>
            </div>
          </Card>

          <Card className="grid">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2>Jogos</h2>
              <SegmentedControl
                label="Separar por categoria"
                value={separateByCategory ? "on" : "off"}
                onChange={(next) => setSeparateByCategory(next === "on")}
                items={[
                  { value: "on", label: "Por categoria" },
                  { value: "off", label: "Todos" },
                ]}
              />
              <SegmentedControl
                label="Ordenação"
                value={sortMode}
                onChange={(next) => setSortMode(next as SortMode)}
                items={[
                  { value: "recent", label: "Mais recentes" },
                  { value: "oldest", label: "Mais antigos" },
                ]}
              />
            </div>

            <p>Jogos sem resultado aparecem primeiro.</p>

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
                        categoryName={separateByCategory ? group.title : match.category.name}
                        phase={match.phase}
                        round={`${parseRoundLabel(match.round)} | Mesa ${match.tableNumber ?? "-"}`}
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
