"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { apiGetAthleteCareer } from "../../../../lib/user-api";
import { ShareActions } from "../../../../components/share/ShareActions";
import { createShareImageBlob } from "../../../../lib/share-image";

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
  nivel: "ESTADUAL" | "COPA" | "NACIONAL" | null;
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
  };
  events: CareerEvent[];
};

type MedalBucket = ReturnType<typeof normalizeMedalTable>;
type MedalColumn = {
  key: keyof MedalBucket;
  label: string;
};

function normalizeMedalTable(input: CareerResponse["medalTable"]) {
  return {
    ESTADUAL: {
      bronze: input?.ESTADUAL?.bronze ?? 0,
      prata: input?.ESTADUAL?.prata ?? 0,
      ouro: input?.ESTADUAL?.ouro ?? 0,
    },
    COPA: {
      bronze: input?.COPA?.bronze ?? 0,
      prata: input?.COPA?.prata ?? 0,
      ouro: input?.COPA?.ouro ?? 0,
    },
    NACIONAL: {
      bronze: input?.NACIONAL?.bronze ?? 0,
      prata: input?.NACIONAL?.prata ?? 0,
      ouro: input?.NACIONAL?.ouro ?? 0,
    },
  };
}

function buildVisibleMedalColumns(table: MedalBucket): MedalColumn[] {
  const columns: MedalColumn[] = [
    { key: "ESTADUAL", label: "Estadual" },
    { key: "COPA", label: "Copa" },
    { key: "NACIONAL", label: "Brasileirão" },
  ];
  return columns.filter((column) => {
    const item = table[column.key];
    return item.ouro + item.prata + item.bronze > 0;
  });
}

function formatDate(value: string | null): string {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleDateString("pt-BR");
}

function formatDatetime(value: string | null): string {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString("pt-BR");
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

function formatSets(match: CareerMatch): string {
  if (match.scoreSets.length > 0) {
    return match.scoreSets.map((set) => `${set.a}-${set.b}`).join(" / ");
  }
  if (match.sets.length === 0) {
    return "-";
  }
  return match.sets.map((set) => `${set.p1}-${set.p2}`).join(" / ");
}

function formatFinalSets(match: CareerMatch): string {
  if (match.scoreFinal) {
    return `${match.scoreFinal.setsA}-${match.scoreFinal.setsB}`;
  }
  if (!match.setsResult) {
    return match.scoreRaw || "-";
  }
  return `${match.setsResult.p1Sets}-${match.setsResult.p2Sets}`;
}

function resolveMatchTone(match: CareerMatch): MatchTone {
  if ((match.winnerIndex === 0 || match.winnerIndex === 1) && (match.athleteIndex === 0 || match.athleteIndex === 1)) {
    if (match.winnerIndex === match.athleteIndex) {
      return "win";
    }
    return "lose";
  }

  if ((match.athleteIndex === 0 || match.athleteIndex === 1) && match.scoreFinal) {
    const athleteSets = match.athleteIndex === 0 ? match.scoreFinal.setsA : match.scoreFinal.setsB;
    const opponentSets = match.athleteIndex === 0 ? match.scoreFinal.setsB : match.scoreFinal.setsA;
    if (athleteSets > opponentSets) {
      return "win";
    }
    if (athleteSets < opponentSets) {
      return "lose";
    }
  }

  if ((match.athleteIndex === 0 || match.athleteIndex === 1) && match.setsResult) {
    const athleteSets = match.athleteIndex === 0 ? match.setsResult.p1Sets : match.setsResult.p2Sets;
    const opponentSets = match.athleteIndex === 0 ? match.setsResult.p2Sets : match.setsResult.p1Sets;
    if (athleteSets > opponentSets) {
      return "win";
    }
    if (athleteSets < opponentSets) {
      return "lose";
    }
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
  return "match-row-neutral";
}

function getClassificationRowClass(position: number | null | undefined): string {
  if (position === 1) {
    return "classification-row-ouro";
  }
  if (position === 2) {
    return "classification-row-prata";
  }
  if (position === 3) {
    return "classification-row-bronze";
  }
  return "classification-row-default";
}

export default function AthleteCareerPage() {
  const params = useParams<{ athleteKey: string }>();
  const athleteKey = decodeURIComponent(params.athleteKey);
  const [payload, setPayload] = useState<CareerResponse | null>(null);

  useEffect(() => {
    void apiGetAthleteCareer(athleteKey).then((data) => setPayload(data as CareerResponse));
  }, [athleteKey]);

  const shareLines = useMemo(() => {
    if (!payload) {
      return [];
    }
    const eventCounts = payload.events.reduce(
      (acc, event) => {
        if (event.nivel === "ESTADUAL") {
          acc.estaduais += 1;
        } else if (event.nivel === "COPA") {
          acc.copas += 1;
        } else if (event.nivel === "NACIONAL") {
          acc.brasileirao += 1;
        }
        return acc;
      },
      { estaduais: 0, copas: 0, brasileirao: 0 },
    );

    return [
      `Estaduais ${eventCounts.estaduais}`,
      `Copas ${eventCounts.copas}`,
      `Brasileirão ${eventCounts.brasileirao}`,
    ];
  }, [payload]);

  const normalizedMedalTable = useMemo(
    () => normalizeMedalTable(payload?.medalTable),
    [payload?.medalTable],
  );
  const visibleMedalColumns = useMemo(
    () => buildVisibleMedalColumns(normalizedMedalTable),
    [normalizedMedalTable],
  );

  return (
    <main className="container grid user-page">
      <section className="hero-header">
        <h1 className="hero-title">Carreira</h1>
        <p className="hero-subtitle">Tênis de Mesa / Table Tennis</p>
        <button type="button" onClick={() => (window.location.href = "/")}>
          Voltar para home
        </button>
      </section>

      {!payload ? (
        <p>Carregando...</p>
      ) : (
        <>
          <section className="card arena-card grid">
            <div className="career-athlete-header">
              <h2>{payload.athlete.nameDisplay}</h2>
              <ShareActions
                inline
                iconOnly
                shareText={`Confira a carreira de ${payload.athlete.nameReduced || payload.athlete.nameDisplay}`}
                fileName={`carreira-${payload.athlete.athleteKey}.png`}
                buildImage={() =>
                  createShareImageBlob({
                    title: payload.athlete.nameDisplay,
                    subtitle: "Tênis de Mesa / Table Tennis",
                    subtitleSecondary: "Carreira",
                    lines: [],
                    metrics: [
                      {
                        label: "UF",
                        value: payload.athlete.stateCode ?? "-",
                      },
                      {
                        label: "Pontos disputados",
                        value: String(payload.totals.performance.pointsPlayed),
                      },
                      {
                        label: "Pontos conquistados",
                        value: String(payload.totals.performance.pointsWon),
                      },
                      {
                        label: "Eficiência",
                        value: formatRatio(payload.totals.performance.ratio),
                      },
                    ],
                    medalTable:
                      visibleMedalColumns.length > 0
                        ? {
                            title: "",
                            columns: visibleMedalColumns.map((column) => ({
                              key: String(column.key),
                              label: column.label,
                            })),
                            rows: [
                              {
                                medalType: "ouro",
                                label: "Ouro",
                                values: visibleMedalColumns.map((column) => normalizedMedalTable[column.key].ouro),
                              },
                              {
                                medalType: "prata",
                                label: "Prata",
                                values: visibleMedalColumns.map((column) => normalizedMedalTable[column.key].prata),
                              },
                              {
                                medalType: "bronze",
                                label: "Bronze",
                                values: visibleMedalColumns.map((column) => normalizedMedalTable[column.key].bronze),
                              },
                            ],
                          }
                        : undefined,
                    footer: "Fonte: PingPong Paid'egua",
                  })
                }
              />
            </div>
            <p>
              Nome reduzido: <strong>{payload.athlete.nameReduced || "-"}</strong>
            </p>
            <p>
              UF/Regiao: <strong>{formatAthleteFederation(payload.athlete)}</strong>
            </p>
            <p>
              Eventos disputados: <strong>{payload.totals.events}</strong>
            </p>
            <p>
              Jogos catalogados: <strong>{payload.totals.matches}</strong>
            </p>
            <p>
              Aproveitamento por pontos (geral): <strong>{formatRatio(payload.totals.performance.ratio)}</strong> (
              {payload.totals.performance.pointsWon}/{payload.totals.performance.pointsPlayed})
            </p>
          </section>

          <section className="card arena-card grid">
            <h2>Quadro de Medalhas</h2>
            {visibleMedalColumns.length === 0 ? (
              <p>Sem medalhas registradas no período.</p>
            ) : (
              <div className="medal-board">
                <div className="medal-lane">
                  <p className="medal-title ouro">Ouro</p>
                  <div className="medal-values">
                    {visibleMedalColumns.map((column) => (
                      <div key={`lane-ouro-${String(column.key)}`} className="count-badge">
                        <span className="count-label">{column.label}</span>
                        <span className="count-value">{String(normalizedMedalTable[column.key].ouro).padStart(2, "0")}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="medal-lane">
                  <p className="medal-title prata">Prata</p>
                  <div className="medal-values">
                    {visibleMedalColumns.map((column) => (
                      <div key={`lane-prata-${String(column.key)}`} className="count-badge">
                        <span className="count-label">{column.label}</span>
                        <span className="count-value">{String(normalizedMedalTable[column.key].prata).padStart(2, "0")}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="medal-lane">
                  <p className="medal-title bronze">Bronze</p>
                  <div className="medal-values">
                    {visibleMedalColumns.map((column) => (
                      <div key={`lane-bronze-${String(column.key)}`} className="count-badge">
                        <span className="count-label">{column.label}</span>
                        <span className="count-value">{String(normalizedMedalTable[column.key].bronze).padStart(2, "0")}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </section>

          <section className="card arena-card grid">
            <h2>Eventos disputados</h2>
            {payload.events.length === 0 ? <p>Nenhum evento encontrado.</p> : null}

            {payload.events.map((event) => (
              <div key={event.id} className="match-group">
                <h3 className="match-group-title">{event.nome}</h3>
                <p>
                  CBTM: <strong>{event.cbtmEventId}</strong> | Periodo: {formatDate(event.dataInicio)} ate{" "}
                  {formatDate(event.dataFim)} | Status: {event.concluido ? "Concluido" : "Em andamento"}
                </p>
                <p>
                  Categorias: {event.categories.map((category) => category.name).join(", ") || "-"}
                </p>
                <p>
                  Aproveitamento no evento: <strong>{formatRatio(event.performance.ratio)}</strong> (
                  {event.performance.pointsWon}/{event.performance.pointsPlayed})
                </p>
                {event.performanceByCategory && event.performanceByCategory.length > 0 ? (
                  <div>
                    <strong>Aproveitamento por categoria</strong>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Categoria</th>
                          <th>Aproveitamento</th>
                          <th>Classificacao</th>
                        </tr>
                      </thead>
                      <tbody>
                        {event.performanceByCategory.map((item) => (
                          <tr
                            key={`${event.id}-${item.categoryId}`}
                            className={getClassificationRowClass(item.classification?.position)}
                          >
                            <td>{item.categoryName}</td>
                            <td>
                              {formatRatio(item.performance.ratio)} ({item.performance.pointsWon}/{item.performance.pointsPlayed})
                            </td>
                            <td>{item.classification?.position ? `${item.classification.position}º` : "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}

                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Categoria</th>
                      <th>Fase</th>
                      <th>Rodada</th>
                      <th>Data/Hora</th>
                      <th>Confronto</th>
                      <th>Sets</th>
                      <th>Final</th>
                    </tr>
                  </thead>
                  <tbody>
                    {event.matches.map((match) => {
                      const tone = resolveMatchTone(match);
                      return (
                      <tr key={match.matchKey} className={toneRowClass(tone)}>
                        <td>{match.category.name}</td>
                        <td>{match.phase}</td>
                        <td>{match.round ?? "-"}</td>
                        <td>{formatDatetime(match.matchDatetime)}</td>
                        <td>
                          {toReducedName(match.players[0]?.name) + " x " + toReducedName(match.players[1]?.name)}
                        </td>
                        <td>{formatSets(match)}</td>
                        <td>{formatFinalSets(match)}</td>
                      </tr>
                    );
                    })}
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

