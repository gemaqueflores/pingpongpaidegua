"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { apiGetAthleteSummary } from "../../../../../../lib/user-api";

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
  return new Date(value).toLocaleDateString("pt-BR");
}

function formatDatetime(value: string | null): string {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString("pt-BR");
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

function toneRowClass(tone: MatchTone): string {
  if (tone === "win") {
    return "match-row-win";
  }
  if (tone === "lose") {
    return "match-row-lose";
  }
  return "";
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

  return (
    <main className="container grid user-page">
      <section className="hero-header">
        <h1 className="hero-title">Resumo do Atleta</h1>
        <p className="hero-subtitle">Tênis de Mesa / Table Tennis</p>
        <button type="button" onClick={() => (window.location.href = `/user/events/${eventId}`)}>
          Voltar para evento
        </button>
      </section>

      {!summary ? (
        <p>Carregando...</p>
      ) : (
        <>
          <section className="card arena-card grid">
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
            <div>
              <strong>Aproveitamento por categoria</strong>
              {summary.performanceByCategory && summary.performanceByCategory.length > 0 ? (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Categoria</th>
                      <th>Aproveitamento</th>
                      <th>Classificacao</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.performanceByCategory.map((item) => (
                      <tr key={item.categoryId}>
                        <td>{item.categoryName}</td>
                        <td>
                          {formatRatio(item.performance.ratio)} ({item.performance.pointsWon}/{item.performance.pointsPlayed})
                        </td>
                        <td>{item.classification?.position ? `${item.classification.position}º` : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p>-</p>
              )}
            </div>
            <div>
              <a href={`/user/career/${encodeURIComponent(summary.athlete.athleteKey)}`}>Abrir carreira</a>
            </div>
          </section>

          <section className="card arena-card grid">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2>Jogos</h2>
              <div className="balloon-group" role="group" aria-label="Agrupar jogos">
                <button
                  type="button"
                  className={`balloon-button ${groupMode === "category" ? "active" : ""}`}
                  onClick={() => setGroupMode("category")}
                >
                  Por categoria
                </button>
                <button
                  type="button"
                  className={`balloon-button ${groupMode === "schedule" ? "active" : ""}`}
                  onClick={() => setGroupMode("schedule")}
                >
                  Por horario
                </button>
              </div>
            </div>

            <p>{summary.noDatetimeFallback}</p>

            {groups.length === 0 ? <p>Nenhum jogo encontrado para este atleta.</p> : null}

            {groups.map((group) => (
              <div key={group.id} className="match-group">
                <h3 className="match-group-title">{group.title}</h3>
                <table className="data-table">
                  <thead>
                    <tr>
                      {groupMode === "schedule" ? <th>Categoria</th> : null}
                      <th>Fase</th>
                      <th>Rodada</th>
                      <th>Mesa</th>
                      <th>Data/Hora</th>
                      <th>Confronto</th>
                      <th>Final</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.matches.map((match) => (
                      (() => {
                        const scoreSetsLabel = formatScoreSets(match);
                        const tone = resolveMatchTone(match);
                        return (
                          <tr key={match.matchKey} className={toneRowClass(tone)}>
                            {groupMode === "schedule" ? <td>{match.category.name}</td> : null}
                            <td>{match.phase}</td>
                            <td>{match.round ?? "-"}</td>
                            <td>{match.tableNumber ?? "-"}</td>
                            <td>{formatDatetime(match.matchDatetime)}</td>
                            <td>
                              {toReducedName(match.players[0]?.name) + " x " + toReducedName(match.players[1]?.name)}
                            </td>
                            <td>
                              <div>{formatFinalSets(match)}</div>
                              {scoreSetsLabel ? <small title={scoreSetsLabel}>{scoreSetsLabel}</small> : null}
                            </td>
                          </tr>
                        );
                      })()
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </section>
        </>
      )}
    </main>
  );
}

