"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGetAthleteCareer } from "../../../../lib/user-api";
import { PageHeader } from "../../../../components/ui/PageHeader";
import { Card } from "../../../../components/ui/Card";
import { Badge } from "../../../../components/ui/Badge";
import { MatchCard } from "../../../../components/ui/MatchCard";
import { Skeleton } from "../../../../components/ui/Skeleton";
import { AthleteSummaryCard } from "../../../../components/career/AthleteSummaryCard";
import type { MedalMatrix } from "../../../../components/career/MedalMatrixTable";
import { DataTableResponsive } from "../../../../components/ui/DataTableResponsive";

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
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Belem",
  }).format(new Date(value));
}

function formatDatetime(value: string | null): string {
  if (!value) return "-";
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

function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

function formatMatchStage(match: CareerMatch): { phase: string; round: string } {
  const phaseRaw = (match.phase ?? "").trim();
  const roundRaw = (match.round ?? "").trim();
  const normalized = `${phaseRaw} ${roundRaw}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();

  if (normalized.includes("RESULTADOS") || normalized.includes("GRUPO") || normalized.includes("UNICA")) {
    if (normalized.includes("UNICA")) {
      return { phase: "Grupo Único", round: "" };
    }

    const groupFromRound = roundRaw.match(/GRUPO\s*\d+/i)?.[0];
    if (groupFromRound) {
      return { phase: groupFromRound.replace(/\s+/g, " ").trim(), round: "" };
    }

    const groupFromPhase = phaseRaw.match(/GRUPO\s*\d+/i)?.[0];
    if (groupFromPhase) {
      return { phase: groupFromPhase.replace(/\s+/g, " ").trim(), round: "" };
    }

    return { phase: roundRaw || "Grupo", round: "" };
  }

  return { phase: phaseRaw || "-", round: roundRaw || "-" };
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
  const router = useRouter();
  const params = useParams<{ athleteKey: string }>();
  const athleteKey = decodeURIComponent(params.athleteKey);
  const [payload, setPayload] = useState<CareerResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draftDateFrom, setDraftDateFrom] = useState<string>(() => {
    const now = new Date();
    const lastYear = new Date(now);
    lastYear.setFullYear(now.getFullYear() - 1);
    return toDateInputValue(lastYear);
  });
  const [draftDateTo, setDraftDateTo] = useState<string>(() => toDateInputValue(new Date()));
  const [dateFrom, setDateFrom] = useState<string>(() => {
    const now = new Date();
    const lastYear = new Date(now);
    lastYear.setFullYear(now.getFullYear() - 1);
    return toDateInputValue(lastYear);
  });
  const [dateTo, setDateTo] = useState<string>(() => toDateInputValue(new Date()));
  const [dateRangeError, setDateRangeError] = useState<string | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<string>("last-year");
  const [visibleEvents, setVisibleEvents] = useState(8);
  const [expandedEvents, setExpandedEvents] = useState<Record<number, boolean>>({});

  useEffect(() => {
    setPayload(null);
    setError(null);
    setVisibleEvents(8);
    setExpandedEvents({});
    void apiGetAthleteCareer(athleteKey)
      .then((data) => setPayload(data as CareerResponse))
      .catch(() => {
        setError("Carreira não encontrada para o atleta informado.");
      });
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
    const recent = tones.slice(0, 5).map((tone) => (tone === "win" ? "V" : tone === "lose" ? "D" : "-"));

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

  const filteredEvents = useMemo(() => {
    const fromTs = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : Number.NEGATIVE_INFINITY;
    const toTs = dateTo ? new Date(`${dateTo}T23:59:59`).getTime() : Number.POSITIVE_INFINITY;
    return sortedEvents.filter((event) => {
      const eventTs = getEventLatestMatchTimestamp(event);
      return eventTs >= fromTs && eventTs <= toTs;
    });
  }, [dateFrom, dateTo, sortedEvents]);

  const visibleFilteredEvents = useMemo(() => filteredEvents.slice(0, visibleEvents), [filteredEvents, visibleEvents]);
  const yearsAvailable = useMemo(() => {
    const years = new Set<number>();
    for (const event of sortedEvents) {
      const ts = getEventLatestMatchTimestamp(event);
      if (ts > 0) {
        years.add(new Date(ts).getFullYear());
      }
    }
    return Array.from(years).sort((a, b) => b - a);
  }, [sortedEvents]);

  const medalMatrix = useMemo(() => {
    if (!payload) return emptyMatrix();
    return computeMedalsByCompetition(payload.events, payload.medalTable);
  }, [payload]);

  const federationText = payload ? formatAthleteFederation(payload.athlete) : null;
  const nextEventName = useMemo(() => {
    if (!payload) return null;
    const now = Date.now();
    const upcoming = payload.events
      .filter((event) => !event.concluido)
      .filter((event) => toTimestamp(event.dataInicio) >= now)
      .sort((left, right) => toTimestamp(left.dataInicio) - toTimestamp(right.dataInicio));
    return upcoming[0]?.nome ?? null;
  }, [payload]);

  function applyDateFilter() {
    if (draftDateFrom && draftDateTo && new Date(`${draftDateFrom}T00:00:00`).getTime() > new Date(`${draftDateTo}T23:59:59`).getTime()) {
      setDateRangeError("Até não pode ser menor que De.");
      return;
    }
    setDateRangeError(null);
    setDateFrom(draftDateFrom);
    setDateTo(draftDateTo);
    setVisibleEvents(8);
  }

  function applyPreset(preset: string) {
    if (preset === "all") {
      setSelectedPreset("all");
      setDraftDateFrom("");
      setDraftDateTo("");
      setDateFrom("");
      setDateTo("");
      setDateRangeError(null);
      setVisibleEvents(8);
      return;
    }

    if (preset === "last-year") {
      const now = new Date();
      const lastYear = new Date(now);
      lastYear.setFullYear(now.getFullYear() - 1);
      const nextFrom = toDateInputValue(lastYear);
      const nextTo = toDateInputValue(now);
      setSelectedPreset("last-year");
      setDraftDateFrom(nextFrom);
      setDraftDateTo(nextTo);
      setDateFrom(nextFrom);
      setDateTo(nextTo);
      setDateRangeError(null);
      setVisibleEvents(8);
      return;
    }

    const year = Number(preset);
    if (Number.isFinite(year)) {
      const nextFrom = `${String(year)}-01-01`;
      const nextTo = `${String(year)}-12-31`;
      setSelectedPreset(String(year));
      setDraftDateFrom(nextFrom);
      setDraftDateTo(nextTo);
      setDateFrom(nextFrom);
      setDateTo(nextTo);
      setDateRangeError(null);
      setVisibleEvents(8);
    }
  }

  return (
    <main className="container grid user-page">
      <PageHeader
        title="Carreira"
        subtitle="Tênis de Mesa / Table Tennis"
        compact
        className="career-page-header"
        actions={
          <button
            type="button"
            className="event-back-button"
            onClick={() => {
              if (window.history.length > 1) {
                router.back();
              } else {
                router.push("/atletas");
              }
            }}
          >
            ← Voltar
          </button>
        }
      />

      {!payload && !error ? (
        <Card className="grid">
          <Skeleton height="24px" width="260px" />
          <Skeleton height="20px" />
          <Skeleton height="20px" />
          <Skeleton height="20px" />
        </Card>
      ) : null}

      {error ? (
        <Card className="grid">
          <h2>Carreira</h2>
          <p>{error}</p>
          <div className="row">
            <button type="button" className="event-back-button" onClick={() => router.push("/atletas")}>
              ← Voltar
            </button>
          </div>
        </Card>
      ) : null}

      {payload && !error ? (
        <>
          <Card className="grid" variant="stat">
            <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
              <h2 style={{ marginBottom: 0 }}>Período da carreira</h2>
              <Badge tone="default">Padrão: último 1 ano</Badge>
            </div>
            <div className="balloon-group letter-tab-strip" role="group" aria-label="Presets de período">
              <button
                type="button"
                className={`balloon-button ${selectedPreset === "last-year" ? "active" : ""}`}
                onClick={() => applyPreset("last-year")}
              >
                Último 1 ano
              </button>
              {yearsAvailable.map((year) => (
                <button
                  key={year}
                  type="button"
                  className={`balloon-button ${selectedPreset === String(year) ? "active" : ""}`}
                  onClick={() => applyPreset(String(year))}
                >
                  {year}
                </button>
              ))}
              <button
                type="button"
                className={`balloon-button ${selectedPreset === "all" ? "active" : ""}`}
                onClick={() => applyPreset("all")}
              >
                Tudo
              </button>
            </div>
            <div className="admin-form-row career-filter-bar">
              <label className="admin-field">
                <span>De</span>
                <input
                  type="date"
                  value={draftDateFrom}
                  onChange={(event) => {
                    setDraftDateFrom(event.target.value);
                    setSelectedPreset("custom");
                  }}
                  className="admin-input"
                />
              </label>
              <label className="admin-field">
                <span>Até</span>
                <input
                  type="date"
                  value={draftDateTo}
                  onChange={(event) => {
                    setDraftDateTo(event.target.value);
                    setSelectedPreset("custom");
                  }}
                  className="admin-input"
                />
              </label>
              <div className="admin-action-row">
                <button type="button" onClick={applyDateFilter}>Aplicar</button>
                <button type="button" className="secondary" onClick={() => applyPreset("last-year")}>Limpar</button>
              </div>
            </div>
            {dateRangeError ? <p className="warn" style={{ margin: 0 }}>{dateRangeError}</p> : null}
          </Card>

          <Card className="grid" variant="stat">
            <div className="balloon-group letter-tab-strip" role="navigation" aria-label="Seções da carreira">
              <a className="balloon-button" href="#resumo" aria-label="Ir para resumo da carreira">
                Ir para Resumo e Medalhas
              </a>
              <a className="balloon-button" href="#eventos" aria-label="Ir para eventos disputados">
                Ir para Eventos
              </a>
            </div>
          </Card>

          <section id="resumo">
            <AthleteSummaryCard
              athleteName={payload.athlete.nameDisplay}
              athleteReducedName={payload.athlete.nameReduced}
              federationText={federationText ?? undefined}
              nextEventName={nextEventName}
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
            />
          </section>

          <Card className="grid" id="eventos">
            <h2>Eventos disputados</h2>
            {filteredEvents.length === 0 ? <p>Nenhum evento encontrado para o período selecionado.</p> : null}

            {visibleFilteredEvents.map((event, eventIndex) => {
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
                      <Badge tone="default">{formatRatio(event.performance.ratio)}</Badge>
                    </div>
                  </div>

                  <p>CBTM: <strong>{event.cbtmEventId}</strong> | Período: {formatDate(event.dataInicio)} até {formatDate(event.dataFim)}</p>
                  <p>Categorias: {event.categories.map((category) => category.name).join(", ") || "-"}</p>

                  <div>
                    <strong>Aproveitamento do evento e por categoria</strong>
                    <DataTableResponsive
                      rows={[
                        {
                          categoryId: -1,
                          categoryName: "Total do evento",
                          performance: event.performance,
                          classification: null,
                        },
                        ...sortedCategoryPerformance,
                      ]}
                      rowClassName={(item) =>
                        item.categoryId === -1 ? "classification-row-default" : getClassificationRowClass(item.classification?.position)
                      }
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
                        <article key={`${event.id}-${item.categoryId}`} className={`athlete-list-card ${item.categoryId === -1 ? "classification-row-default" : getClassificationRowClass(item.classification?.position)}`}>
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
                  </div>

                  <details
                    className="career-event-matches"
                    open={eventIndex === 0}
                    onToggle={(evt) => {
                      const target = evt.currentTarget;
                      setExpandedEvents((prev) => ({ ...prev, [event.id]: target.open }));
                    }}
                  >
                    <summary>Jogos do evento ({sortedMatches.length})</summary>
                    {expandedEvents[event.id] || eventIndex === 0 ? (
                      sortedMatches.length > 0 ? (
                        <div className="match-card-grid">
                          {sortedMatches.map((match) => {
                            const tone = resolveMatchTone(match);
                            const stage = formatMatchStage(match);
                            return (
                              <MatchCard
                                key={match.matchKey}
                                categoryName={match.category.name}
                                phase={stage.phase}
                                round={stage.round}
                                datetime={formatDatetime(match.matchDatetime)}
                                confrontation={`${toReducedName(match.players[0]?.name)} x ${toReducedName(match.players[1]?.name)}`}
                                setsLine={formatSets(match)}
                                finalLine={formatFinalSets(match)}
                                tone={tone}
                              />
                            );
                          })}
                        </div>
                      ) : (
                        <p className="arena-muted">Evento ainda não realizado.</p>
                      )
                    ) : null}
                  </details>
                </div>
              );
            })}
            {filteredEvents.length > visibleEvents ? (
              <div className="row" style={{ justifyContent: "center" }}>
                <button type="button" onClick={() => setVisibleEvents((prev) => prev + 8)}>
                  Carregar mais eventos
                </button>
              </div>
            ) : null}
          </Card>
        </>
      ) : null}
    </main>
  );
}
