"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  apiGetAthletes,
  apiGetEventCategoryMedalists,
  apiGetClubAthletes,
  apiGetClubs,
  apiGetEventEfficiency,
  apiGetEventSchedule,
  apiGetEventSummary,
  type EventCategoryMedalistsResponse,
  type EventEfficiencyResponse,
  type EventEfficiencyRow,
  type EventScheduleResponse,
  type UserEventRow,
} from "../../../../lib/user-api";
import { Hero } from "../../../../components/ui/Hero";
import { Card } from "../../../../components/ui/Card";
import { Badge } from "../../../../components/ui/Badge";
import { Skeleton } from "../../../../components/ui/Skeleton";
import { SearchInput } from "../../../../components/ui/SearchInput";
import { SegmentedControl } from "../../../../components/ui/SegmentedControl";
import { EmptyState } from "../../../../components/ui/EmptyState";
import { DataTableResponsive } from "../../../../components/ui/DataTableResponsive";

type EventRow = UserEventRow;
type EventTab = "grupos" | "confrontos" | "clubes" | "atletas" | "eficiencia";
type EfficiencyViewMode = "quantidade" | "pontuacao";

type ClubRow = {
  id: number;
  name: string;
  athleteCount?: number;
};

type AthleteRow = {
  id: number;
  nameDisplay?: string;
  name?: string;
  stateCode?: string | null;
  region?: string | null;
  club?: { name: string } | null;
  categoryNames?: string[];
};
const ATHLETES_PAGE_SIZE = 30;
const MEDALISTS_PAGE_SIZE = 20;
type EventPhase = "INSCRICOES_ABERTAS" | "INSCRICOES_ENCERRADAS" | "EM_DISPUTA" | "CONCLUIDO";
const EVENT_TIME_ZONE = "America/Belem";

function toBelemDateKey(input: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: EVENT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(input);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00";

  return `${get("year")}-${get("month")}-${get("day")}`;
}

function hasReachedEventLastDay(event: EventRow | null): boolean {
  if (!event) {
    return false;
  }

  const endRaw = event.fimRealizacao ?? event.dataFim;
  if (!endRaw) {
    return false;
  }

  const eventEnd = new Date(endRaw);
  if (Number.isNaN(eventEnd.getTime())) {
    return false;
  }

  const todayKey = toBelemDateKey(new Date());
  const lastDayKey = toBelemDateKey(eventEnd);
  return todayKey >= lastDayKey;
}

function formatAthleteFederation(athlete: AthleteRow): string {
  if (!athlete.stateCode || !athlete.region) {
    return "-";
  }
  return `${athlete.stateCode} - ${athlete.region}`;
}

function formatDate(value: string | null): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: EVENT_TIME_ZONE,
  }).format(new Date(value));
}

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  const parts = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: EVENT_TIME_ZONE,
  }).formatToParts(new Date(value));

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00";

  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")}`;
}

function formatScheduleName(value: string | null | undefined): string {
  return (value ?? "-").replace(/\s*#\s*/g, " / ");
}

function inferEventType(name: string): "ESTADUAL" | "COPA" | "BRASILEIRAO" | "OPEN" {
  const normalized = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
  if (normalized.includes("OPEN")) return "OPEN";
  if (normalized.includes("COPA")) return "COPA";
  if (normalized.includes("BRASILEIR") || normalized.includes("NACIONAL")) return "BRASILEIRAO";
  return "ESTADUAL";
}

function resolveEventStatusLabel(event: EventRow | null): string {
  if (!event) {
    return "-";
  }

  if (event.concluido || event.situacaoComputada === "POS_EVENTO") {
    return "Encerrado";
  }

  if (event.situacaoComputada === "EM_ANDAMENTO") {
    return "Em Realização";
  }

  if (event.situacaoComputada === "POS_INSCRICOES_PRE_EVENTO") {
    return event.groupsDefined ? "Grupos Divulgados" : "Formação de Grupos";
  }

  if (event.situacaoComputada === "GRADES_PUBLICADAS_PRE_JOGO") {
    return "Confrontos Publicados";
  }

  if (event.situacaoComputada === "INSCRICOES_ABERTAS" || event.situacaoComputada === "PRE_INSCRICOES") {
    return "Inscrições Abertas";
  }

  if (event.situacaoComputada === "DRAFT") {
    return "Formação de Grupos";
  }

  return "-";
}

function resolveEventBanner(event: EventRow | null): { message: string; tone: "info" | "success" } | null {
  if (!event) return null;
  if (event.concluido || event.situacaoComputada === "POS_EVENTO") {
    return { message: "Resultado oficial consolidado", tone: "success" };
  }
  if (event.situacaoComputada === "EM_ANDAMENTO") {
    return { message: "Evento em andamento — dados parciais", tone: "info" };
  }
  if (event.situacaoComputada === "GRADES_PUBLICADAS_PRE_JOGO") {
    return { message: "Confrontos oficiais publicados — aguardando início dos placares", tone: "info" };
  }
  return null;
}

function resolveEventPhase(event: EventRow | null): EventPhase {
  if (!event) return "INSCRICOES_ABERTAS";
  if (event.concluido || event.situacaoComputada === "POS_EVENTO") return "CONCLUIDO";
  if (event.situacaoComputada === "EM_ANDAMENTO") return "EM_DISPUTA";
  if (event.situacaoComputada === "INSCRICOES_ABERTAS" || event.situacaoComputada === "PRE_INSCRICOES") {
    return "INSCRICOES_ABERTAS";
  }
  return "INSCRICOES_ENCERRADAS";
}

function resolvePhaseHelpText(phase: EventPhase): string {
  if (phase === "INSCRICOES_ABERTAS") return "As inscrições estão abertas. O simulador usa a base mais recente de inscritos.";
  if (phase === "INSCRICOES_ENCERRADAS") return "Inscrições finalizadas. Use o simulador para projetar grupos antes da divulgação oficial.";
  if (phase === "EM_DISPUTA") return "Evento em disputa. Resultados podem mudar ao longo do dia.";
  return "Evento concluído. Ranking oficial consolidado.";
}

export default function EventDetailPage() {
  const params = useParams<{ id: string }>();
  const eventId = Number(params.id);

  const [event, setEvent] = useState<EventRow | null>(null);
  const [activeTab, setActiveTab] = useState<EventTab>("grupos");

  const [clubs, setClubs] = useState<ClubRow[]>([]);
  const [clubsLoading, setClubsLoading] = useState(false);
  const [clubSearch, setClubSearch] = useState("");
  const [expandedClubs, setExpandedClubs] = useState<Record<number, boolean>>({});
  const [clubAthletesByClub, setClubAthletesByClub] = useState<Record<number, AthleteRow[]>>({});
  const [clubCountFallbackById, setClubCountFallbackById] = useState<Record<number, number>>({});
  const [clubLoadingById, setClubLoadingById] = useState<Record<number, boolean>>({});

  const [athleteSearch, setAthleteSearch] = useState("");
  const [athletes, setAthletes] = useState<AthleteRow[]>([]);
  const [athletesVisible, setAthletesVisible] = useState(ATHLETES_PAGE_SIZE);
  const [athletesLoading, setAthletesLoading] = useState(false);
  const [loadingEvent, setLoadingEvent] = useState(true);
  const [efficiencyData, setEfficiencyData] = useState<EventEfficiencyResponse | null>(null);
  const [efficiencyLoading, setEfficiencyLoading] = useState(false);
  const [medalistsData, setMedalistsData] = useState<EventCategoryMedalistsResponse | null>(null);
  const [medalistsLoading, setMedalistsLoading] = useState(false);
  const [medalistsVisible, setMedalistsVisible] = useState(MEDALISTS_PAGE_SIZE);
  const [scheduleData, setScheduleData] = useState<EventScheduleResponse | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [efficiencyMode, setEfficiencyMode] = useState<EfficiencyViewMode>("pontuacao");

  useEffect(() => {
    void apiGetEventSummary(eventId)
      .then((item) => {
        setEvent(item as EventRow);
      })
      .catch(() => {
        setEvent(null);
      })
      .finally(() => setLoadingEvent(false));
  }, [eventId]);

  useEffect(() => {
    if (!event) return;
    const hasPublishedMatches = (event.totalPartidasPublicadas ?? 0) > 0;
    if (hasReachedEventLastDay(event)) {
      setActiveTab("eficiencia");
      return;
    }
    if (hasPublishedMatches) {
      setActiveTab("confrontos");
      return;
    }
    const groupsPublished =
      event.situacaoComputada === "GRADES_PUBLICADAS_PRE_JOGO" ||
      (event.situacaoComputada === "POS_INSCRICOES_PRE_EVENTO" && event.groupsDefined);
    if (groupsPublished) {
      setActiveTab("atletas");
      return;
    }
    if (event.concluido || event.situacaoComputada === "EM_ANDAMENTO" || event.situacaoComputada === "POS_EVENTO") {
      setActiveTab("eficiencia");
      return;
    }
    if (event.groupSimulationEligible) {
      setActiveTab("grupos");
    }
  }, [event]);

  useEffect(() => {
    if (activeTab !== "eficiencia") {
      return;
    }

    setEfficiencyLoading(true);
    void apiGetEventEfficiency(eventId)
      .then((response) => setEfficiencyData(response))
      .finally(() => setEfficiencyLoading(false));
  }, [activeTab, eventId, event?.lastScrapeAt]);

  useEffect(() => {
    if (activeTab !== "eficiencia") {
      return;
    }

    setMedalistsLoading(true);
    void apiGetEventCategoryMedalists(eventId)
      .then((response) => setMedalistsData(response))
      .finally(() => setMedalistsLoading(false));
  }, [activeTab, eventId, event?.lastScrapeAt]);

  useEffect(() => {
    if (activeTab !== "confrontos") {
      return;
    }

    setScheduleLoading(true);
    void apiGetEventSchedule(eventId)
      .then((response) => setScheduleData(response))
      .finally(() => setScheduleLoading(false));
  }, [activeTab, eventId, event?.lastScrapeAt]);

  useEffect(() => {
    setMedalistsVisible(MEDALISTS_PAGE_SIZE);
  }, [eventId, activeTab, medalistsData?.categories?.length]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setAthletesLoading(true);
      void apiGetAthletes(eventId, athleteSearch)
        .then((rows) => setAthletes(rows as AthleteRow[]))
        .finally(() => setAthletesLoading(false));
    }, 250);
    return () => clearTimeout(timeout);
  }, [eventId, athleteSearch]);

  useEffect(() => {
    setAthletesVisible(ATHLETES_PAGE_SIZE);
  }, [athleteSearch]);

  useEffect(() => {
    setClubsLoading(true);
    setExpandedClubs({});
    setClubAthletesByClub({});
    setClubCountFallbackById({});
    void apiGetClubs(eventId)
      .then((rows) => {
        const clubRows = rows as ClubRow[];
        setClubs(clubRows);

        const missingCount = clubRows.filter((club) => !Number.isFinite(club.athleteCount));
        if (missingCount.length > 0) {
          void hydrateMissingClubCounts(missingCount);
        }
      })
      .finally(() => setClubsLoading(false));
  }, [eventId]);

  async function hydrateMissingClubCounts(clubRows: ClubRow[]) {
    const entries = await Promise.all(
      clubRows.map(async (club) => {
        try {
          const data = await apiGetClubAthletes(eventId, club.id);
          const athletes = (data.athletes ?? []) as AthleteRow[];
          return [club.id, athletes.length] as const;
        } catch {
          return [club.id, 0] as const;
        }
      }),
    );

    setClubCountFallbackById((previous) => {
      const next = { ...previous };
      for (const [clubId, count] of entries) {
        next[clubId] = count;
      }
      return next;
    });
  }

  async function toggleClub(clubId: number) {
    const isExpanded = Boolean(expandedClubs[clubId]);
    if (isExpanded) {
      setExpandedClubs((previous) => ({ ...previous, [clubId]: false }));
      return;
    }

    setExpandedClubs((previous) => ({ ...previous, [clubId]: true }));
    if (clubAthletesByClub[clubId]) return;

    setClubLoadingById((previous) => ({ ...previous, [clubId]: true }));
    try {
      const data = await apiGetClubAthletes(eventId, clubId);
      setClubAthletesByClub((previous) => ({
        ...previous,
        [clubId]: (data.athletes ?? []) as AthleteRow[],
      }));
    } finally {
      setClubLoadingById((previous) => ({ ...previous, [clubId]: false }));
    }
  }

  const filteredClubs = useMemo(() => {
    const query = clubSearch.trim().toUpperCase();
    if (!query) return clubs;
    return clubs.filter((club) => club.name.toUpperCase().includes(query));
  }, [clubSearch, clubs]);

  const eventType = event
    ? event.nivel === "OPEN"
      ? "OPEN"
      : inferEventType(event.nome)
    : null;

  const statusLabel = resolveEventStatusLabel(event);
  const statusTone =
    statusLabel === "Encerrado"
      ? "done"
      : statusLabel === "Inscrições Abertas" || statusLabel === "Em Realização"
        ? "open"
        : "closed";
  const isGroupsPublished =
    event?.situacaoComputada === "GRADES_PUBLICADAS_PRE_JOGO" ||
    (event?.situacaoComputada === "POS_INSCRICOES_PRE_EVENTO" && Boolean(event?.groupsDefined));
  const hasPublishedMatches = (event?.totalPartidasPublicadas ?? 0) > 0;
  const hideGroupsTab =
    Boolean(event?.concluido) ||
    event?.situacaoComputada === "EM_ANDAMENTO" ||
    event?.situacaoComputada === "POS_EVENTO" ||
    isGroupsPublished ||
    hasPublishedMatches;

  const tabs: Array<{ id: EventTab; label: string }> = [
    ...(hideGroupsTab ? [] : [{ id: "grupos" as const, label: "Grupos" }]),
    ...(hasPublishedMatches ? [{ id: "confrontos" as const, label: "Confrontos" }] : []),
    { id: "clubes", label: "Clubes" },
    { id: "atletas", label: "Atletas" },
    { id: "eficiencia", label: "Eficiência do evento" },
  ];
  const eventBanner = resolveEventBanner(event);
  const hasConcludedPodium = Boolean(event?.concluido);
  const eventPhase = resolveEventPhase(event);
  const phaseHelpText = resolvePhaseHelpText(eventPhase);
  const sortedAthletes = useMemo(() => {
    return [...athletes].sort((left, right) =>
      (left.nameDisplay ?? left.name ?? "").localeCompare(right.nameDisplay ?? right.name ?? "", "pt-BR", {
        sensitivity: "base",
      }),
    );
  }, [athletes]);
  const visibleAthletes = useMemo(() => sortedAthletes.slice(0, athletesVisible), [sortedAthletes, athletesVisible]);

  const rankedEfficiencyRows = useMemo(() => {
    const rows = [...(efficiencyData?.ranking ?? [])];
    rows.sort((left, right) => {
      const leftTotal = efficiencyMode === "pontuacao" ? left.totalPontuacao : left.totalQuantidade;
      const rightTotal = efficiencyMode === "pontuacao" ? right.totalPontuacao : right.totalQuantidade;
      if (leftTotal !== rightTotal) {
        return rightTotal - leftTotal;
      }
      if (left.ouro !== right.ouro) {
        return right.ouro - left.ouro;
      }
      if (left.prata !== right.prata) {
        return right.prata - left.prata;
      }
      if (left.bronze !== right.bronze) {
        return right.bronze - left.bronze;
      }
      return left.clubName.localeCompare(right.clubName, "pt-BR", { sensitivity: "base" });
    });
    return rows;
  }, [efficiencyData?.ranking, efficiencyMode]);

  const mobileEfficiencyRows = useMemo(() => {
    if (!hasConcludedPodium) return rankedEfficiencyRows;
    return rankedEfficiencyRows.slice(3);
  }, [hasConcludedPodium, rankedEfficiencyRows]);
  const medalistCategories = useMemo(() => medalistsData?.categories ?? [], [medalistsData?.categories]);
  const visibleMedalistCategories = useMemo(
    () => medalistCategories.slice(0, medalistsVisible),
    [medalistCategories, medalistsVisible],
  );

  function valueForMode(row: EventEfficiencyRow, medalha: "ouro" | "prata" | "bronze" | "total"): number {
    if (efficiencyMode === "quantidade") {
      if (medalha === "total") return row.totalQuantidade;
      return row[medalha];
    }
    if (medalha === "total") return row.totalPontuacao;
    return row.pontuacao[medalha];
  }

  function podiumClass(index: number): string {
    if (index === 0) return "eff-row-gold";
    if (index === 1) return "eff-row-silver";
    if (index === 2) return "eff-row-bronze";
    return "";
  }

  function podiumLabel(index: number): string {
    if (index === 0) return "🥇 1º lugar";
    if (index === 1) return "🥈 2º lugar";
    return "🥉 3º lugar";
  }

  return (
    <main className="container grid user-page">
      <Hero
        title={event ? event.nome : `Evento ${eventId}`}
        subtitle={`Período: ${formatDate(event?.dataInicio ?? null)} até ${formatDate(event?.dataFim ?? null)}`}
        className="event-page-hero"
        actions={
          <Link className="event-back-button" href="/">← Voltar</Link>
        }
      />

      {loadingEvent ? (
        <Card className="grid">
          <Skeleton height="24px" />
          <Skeleton height="20px" />
        </Card>
      ) : !event ? (
        <Card className="grid">
          <h2>Evento não encontrado</h2>
          <p>Não foi possível localizar os dados deste evento na base.</p>
          <div className="row">
            <Link className="event-back-button" href="/events">
              ← Voltar
            </Link>
          </div>
        </Card>
      ) : (
        <Card className={`grid event-summary-card ${event?.concluido ? "event-summary-concluded" : ""}`} variant="event">
          <div className="row event-summary-head">
            <h2>Resumo do evento</h2>
            <div className="row event-status-badges">
              <Badge tone={statusTone}>{statusLabel}</Badge>
              {eventType ? (
                <Badge tone="default">
                  {eventType === "BRASILEIRAO" ? "Brasileirão" : eventType}
                </Badge>
              ) : null}
            </div>
          </div>
          <div className="row event-last-update-row">
            <Badge tone="default">Última atualização: {formatDateTime(event?.lastScrapeAt ?? null)}</Badge>
          </div>
          <div className="event-metrics">
            <span className="event-metric-card"><small>Atletas</small><strong>{String(event?.totalInscritos ?? 0)}</strong></span>
            <span className="event-metric-card"><small>Categorias</small><strong>{String(event?.totalCategorias ?? 0)}</strong></span>
            <span className="event-metric-card"><small>Inscrições</small><strong>{String(event?.associacoesAtletaCategoria ?? event?.inscricoesTotaisOficiais ?? event?.totalInscritos ?? 0)}</strong></span>
            <span className="event-metric-card"><small>Partidas Previstas</small><strong>{String(event?.totalPartidasPrevistas ?? event?.totalPartidasCalculadas ?? event?.totalPartidas ?? 0)}</strong></span>
            <span className="event-metric-card"><small>Partidas</small><strong>{String(event?.totalPartidasJogadas ?? event?.totalPartidas ?? 0)}</strong></span>
            <span className="event-metric-card"><small>WO</small><strong>{String(event?.totalPartidasWo ?? 0)}</strong></span>
          </div>
          <div className="event-tabs-shell">
            <SegmentedControl
              className="letter-tab-strip letter-tab-sticky"
              label="Seções do evento"
              value={activeTab}
              onChange={(next) => setActiveTab(next as EventTab)}
              items={tabs.map((tab) => ({ value: tab.id, label: tab.label }))}
            />
          </div>
          {eventBanner ? (
            <div className={`event-state-banner event-state-banner-${eventBanner.tone}`} role="status" aria-live="polite">
              {eventBanner.tone === "success" ? <span className="event-state-banner-icon">✅</span> : null}
              <span>{eventBanner.message}</span>
            </div>
          ) : null}
        </Card>
      )}

      {activeTab === "grupos" && !hideGroupsTab ? (
        <Card className="grid event-tab-panel">
          <h2>Grupos</h2>
          <p className="arena-muted" style={{ marginTop: 0 }}>{phaseHelpText}</p>
          {event?.groupsDefined ? <p>Grupos oficiais já divulgados para este evento.</p> : null}
          <div className="row">
            <Link
              className={`event-athlete-details-button ${Boolean(event?.concluido) || Boolean(event?.groupsDefined) || !Boolean(event?.groupSimulationEligible) ? "is-disabled" : ""}`}
              href={`/events/${eventId}/group-simulator`}
              aria-disabled={Boolean(event?.concluido) || Boolean(event?.groupsDefined) || !Boolean(event?.groupSimulationEligible)}
              onClick={(evt) => {
                if (Boolean(event?.concluido) || Boolean(event?.groupsDefined) || !Boolean(event?.groupSimulationEligible)) {
                  evt.preventDefault();
                }
              }}
              title={event?.groupsDefined ? "Simulação indisponível: grupos oficiais já publicados." : undefined}
            >
              {event?.concluido
                ? "Evento concluído"
                : event?.groupsDefined
                  ? "Simulação bloqueada (grupos publicados)"
                  : "Simular Grupos"}
            </Link>
          </div>
          {!event?.concluido ? (
            <p className="arena-muted">A simulação considera o cenário atual de atletas confirmados e pré-inscritos.</p>
          ) : null}
          {!event?.groupsDefined && !event?.groupSimulationEligible ? (
            <p className="arena-muted">Simulador indisponível para o momento atual do evento.</p>
          ) : null}
        </Card>
      ) : null}

      {activeTab === "confrontos" ? (
        <Card className="grid event-tab-panel">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <h2>Confrontos</h2>
            <Badge tone="default">
              {String(scheduleData?.categories.reduce((sum, category) => sum + category.matches.length, 0) ?? 0)} partidas
            </Badge>
          </div>
          {scheduleLoading ? (
            <div className="grid">
              <Skeleton height="64px" />
              <Skeleton height="64px" />
              <Skeleton height="64px" />
            </div>
          ) : null}
          {!scheduleLoading && (scheduleData?.categories.length ?? 0) === 0 ? (
            <EmptyState
              title="Nenhum confronto encontrado"
              description="Os confrontos serão exibidos quando houver partidas publicadas para este evento."
            />
          ) : null}
          {!scheduleLoading && scheduleData?.categories.length ? (
            <div className="grid" style={{ gap: "12px" }}>
              {scheduleData.categories.map((category, index) => (
                <details key={category.categoryId} className="athlete-list-card" open={index === 0}>
                  <summary className="row" style={{ justifyContent: "space-between", cursor: "pointer" }}>
                    <strong>{category.categoryName}</strong>
                    <span className="arena-muted">{category.matches.length} partidas</span>
                  </summary>
                  <div className="grid" style={{ gap: "8px", marginTop: "10px" }}>
                    {category.matches.map((match) => (
                      <article key={match.id} className="event-schedule-match">
                        <div className="row" style={{ justifyContent: "space-between", gap: "10px" }}>
                          <strong>{formatDateTime(match.matchDatetime)}</strong>
                          <span className="arena-muted">
                            {match.tableNumber ? `Mesa ${match.tableNumber}` : "Mesa -"}
                            {match.round ? ` | ${match.round}` : ""}
                          </span>
                        </div>
                        <div className="row" style={{ justifyContent: "space-between", gap: "12px" }}>
                          <span>
                            {formatScheduleName(match.playerA?.name)}
                            {match.playerA?.clubName ? ` · ${match.playerA.clubName}` : ""}
                          </span>
                          <strong>vs</strong>
                          <span>
                            {formatScheduleName(match.playerB?.name)}
                            {match.playerB?.clubName ? ` · ${match.playerB.clubName}` : ""}
                          </span>
                        </div>
                        {match.scoreRaw ? <Badge tone="default">Placar: {match.scoreRaw}</Badge> : null}
                      </article>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          ) : null}
        </Card>
      ) : null}

      {activeTab === "clubes" ? (
        <Card className="grid event-tab-panel">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2>Clubes</h2>
            <SearchInput
              value={clubSearch}
              onDebouncedChange={setClubSearch}
              placeholder="Buscar clube"
              ariaLabel="Buscar clube"
            />
          </div>
          {clubsLoading ? (
            <div className="grid">
              <Skeleton height="56px" />
              <Skeleton height="56px" />
              <Skeleton height="56px" />
            </div>
          ) : null}
          {!clubsLoading && filteredClubs.length === 0 ? (
            <EmptyState
              title="Nenhum clube encontrado"
              description="Ajuste o filtro para exibir clubes deste evento."
            />
          ) : null}

          <div className="grid">
            {filteredClubs.map((club) => {
              const isExpanded = Boolean(expandedClubs[club.id]);
              const athletesInClub = clubAthletesByClub[club.id] ?? [];
              const resolvedCount =
                (clubAthletesByClub[club.id] ? athletesInClub.length : null) ??
                (Number.isFinite(club.athleteCount) ? Number(club.athleteCount) : null) ??
                clubCountFallbackById[club.id] ??
                athletesInClub.length;
              return (
                <article key={club.id} className="athlete-list-card">
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <h3 style={{ margin: 0 }}>{club.name}</h3>
                    <span className="club-athlete-count">{resolvedCount} atletas</span>
                  </div>
                  <div className="row">
                    <button className="club-expand-button" onClick={() => toggleClub(club.id)}>
                      {isExpanded ? "Recolher atletas" : "Expandir atletas"}
                    </button>
                  </div>

                  <div className={`club-athletes-panel ${isExpanded ? "open" : ""}`}>
                    <div className="grid">
                      {clubLoadingById[club.id] ? <p>Carregando atletas...</p> : null}
                      {!clubLoadingById[club.id] && athletesInClub.length === 0 ? (
                        <p>Nenhum atleta listado para este clube.</p>
                      ) : null}
                      {!clubLoadingById[club.id] && athletesInClub.length > 0 ? (
                        <ul>
                          {athletesInClub.map((athlete) => (
                            <li key={athlete.id}>
                              <Link href={`/events/${eventId}/athletes/${athlete.id}`}>
                                {athlete.nameDisplay ?? athlete.name}
                                {athlete.categoryNames && athlete.categoryNames.length > 0
                                  ? ` (${athlete.categoryNames.join(" / ")})`
                                  : ""}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </Card>
      ) : null}

      {activeTab === "atletas" ? (
        <Card className="grid event-tab-panel">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <h2>Atletas do evento</h2>
            <Badge tone="default">Filtrados: {sortedAthletes.length}</Badge>
          </div>
          <SearchInput
            value={athleteSearch}
            onDebouncedChange={setAthleteSearch}
            placeholder="Buscar atleta por nome"
            ariaLabel="Buscar atleta por nome"
            stickyClassName="atletas-search-sticky"
          />
          {athletesLoading ? (
            <div className="grid">
              <Skeleton height="52px" />
              <Skeleton height="52px" />
              <Skeleton height="52px" />
            </div>
          ) : (
            <>
              <DataTableResponsive
                rows={visibleAthletes}
                empty={
                  <EmptyState
                    title="Nenhum atleta encontrado"
                    description="Ajuste o termo da busca para encontrar atletas deste evento."
                  />
                }
                columns={[
                  { key: "atleta", header: "Atleta", render: (athlete) => athlete.nameDisplay ?? athlete.name },
                  { key: "clube", header: "Clube", render: (athlete) => athlete.club?.name ?? "-" },
                  { key: "federacao", header: "UF/Região", render: (athlete) => formatAthleteFederation(athlete) },
                  {
                    key: "acoes",
                    header: "Ações",
                    render: (athlete) => <Link href={`/events/${eventId}/athletes/${athlete.id}`}>Detalhes</Link>,
                  },
                ]}
                mobileCard={(athlete) => (
                  <article key={athlete.id} className="athlete-list-card">
                    <h3>{athlete.nameDisplay ?? athlete.name}</h3>
                    <p className="arena-muted" style={{ margin: 0 }}>{athlete.club?.name ?? "-"}</p>
                    <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                      <Badge tone="default">{athlete.stateCode ?? "-"}</Badge>
                    </div>
                    <Link className="event-athlete-details-button" href={`/events/${eventId}/athletes/${athlete.id}`}>
                      Detalhes
                    </Link>
                  </article>
                )}
              />
              {sortedAthletes.length > athletesVisible ? (
                <div className="row" style={{ justifyContent: "center" }}>
                  <button type="button" onClick={() => setAthletesVisible((current) => current + ATHLETES_PAGE_SIZE)}>
                    Carregar mais atletas
                  </button>
                </div>
              ) : null}
            </>
          )}
        </Card>
      ) : null}

      {activeTab === "eficiencia" ? (
        <Card className="grid event-tab-panel">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2>Eficiência dos clubes</h2>
            <SegmentedControl
              label="Modo de exibição da eficiência"
              value={efficiencyMode}
              onChange={(next) => setEfficiencyMode(next as EfficiencyViewMode)}
              items={[
                { value: "quantidade", label: "Quantidade" },
                { value: "pontuacao", label: "Pontuação" },
              ]}
            />
          </div>
          {efficiencyData ? (
            <p className="arena-muted" style={{ marginTop: 0 }}>
              Exibir por: {efficiencyMode === "pontuacao" ? "Pontuação" : "Quantidade"} | Pesos atuais: Ouro {efficiencyData.weights.pesoOuro}, Prata {efficiencyData.weights.pesoPrata}, Bronze {efficiencyData.weights.pesoBronze}
              {typeof efficiencyData.eventWeight === "number" ? ` | Peso do evento: ${efficiencyData.eventWeight}` : ""}
            </p>
          ) : null}

          {efficiencyLoading ? (
            <div className="grid">
              <Skeleton height="50px" />
              <Skeleton height="50px" />
              <Skeleton height="50px" />
            </div>
          ) : null}
          {!efficiencyLoading && rankedEfficiencyRows.length === 0 ? (
            <EmptyState
              title="Nenhuma pontuação registrada"
              description="A eficiência será calculada quando resultados forem publicados."
            />
          ) : null}

          {!efficiencyLoading && rankedEfficiencyRows.length > 0 && hasConcludedPodium ? (
            <section className="event-efficiency-podium" aria-label="Pódio da eficiência do evento">
              <h3 style={{ margin: 0 }}>Pódio da eficiência</h3>
              <div className="event-efficiency-podium-grid">
                {rankedEfficiencyRows.slice(0, 3).map((row, index) => (
                  <article key={row.clubId} className={`event-efficiency-podium-card ${podiumClass(index)}`}>
                    <span className="event-efficiency-podium-label">{podiumLabel(index)}</span>
                    <strong className="event-efficiency-podium-club">
                      <Link href={`/eficiencia/${row.clubId}`}>{row.clubName}</Link>
                    </strong>
                    <span className="event-efficiency-podium-total">Total: {valueForMode(row, "total")}</span>
                    <span className="arena-muted">
                      🥇 {valueForMode(row, "ouro")} • 🥈 {valueForMode(row, "prata")} • 🥉 {valueForMode(row, "bronze")}
                    </span>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          {!efficiencyLoading && rankedEfficiencyRows.length > 0 ? (
            <DataTableResponsive
              rows={rankedEfficiencyRows}
              rowClassName={(row, index) => podiumClass(index)}
              empty={null}
              columns={[
                { key: "rank", header: "#", render: (_, index) => index + 1 },
                { key: "clube", header: "Clube", render: (row) => <Link href={`/eficiencia/${row.clubId}`}>{row.clubName}</Link> },
                { key: "atletas", header: "Atletas", render: (row) => row.athleteCount },
                { key: "ouro", header: "🥇", render: (row) => valueForMode(row, "ouro") },
                { key: "prata", header: "🥈", render: (row) => valueForMode(row, "prata") },
                { key: "bronze", header: "🥉", render: (row) => valueForMode(row, "bronze") },
                { key: "total", header: "Total", render: (row) => <strong>{valueForMode(row, "total")}</strong> },
              ]}
              mobileCard={(_, __) => null}
              className="event-efficiency-responsive"
            />
          ) : null}

          {!efficiencyLoading && mobileEfficiencyRows.length > 0 ? (
            <div className="event-efficiency-mobile-list data-table-responsive-mobile">
              {mobileEfficiencyRows.map((row, listIndex) => {
                const index = hasConcludedPodium ? listIndex + 3 : listIndex;
                return (
                  <article key={row.clubId} className={`athlete-list-card ${podiumClass(index)}`}>
                    <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                      <strong>#{index + 1} {row.clubName}</strong>
                      <strong className="event-efficiency-total">{valueForMode(row, "total")}</strong>
                    </div>
                    <p className="arena-muted" style={{ margin: 0 }}>
                      Atletas {row.athleteCount} | 🥇 {valueForMode(row, "ouro")} | 🥈 {valueForMode(row, "prata")} | 🥉 {valueForMode(row, "bronze")}
                    </p>
                  </article>
                );
              })}
            </div>
          ) : null}

          <section className="grid" style={{ gap: "10px" }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h3 style={{ margin: 0 }}>Medalhistas por categoria</h3>
              {!medalistsLoading ? (
                <Badge tone="default">
                  {String(medalistsData?.categories?.filter((item) => item.medalists.length > 0).length ?? 0)} categorias com pódio
                </Badge>
              ) : null}
            </div>
            {medalistsLoading ? <p className="arena-muted">Carregando medalhistas...</p> : null}
            {!medalistsLoading && (medalistsData?.categories?.length ?? 0) === 0 ? (
              <p className="arena-muted">Sem categorias com atletas vinculados para auditoria.</p>
            ) : null}
            {!medalistsLoading && medalistCategories.length > 0 ? (
              <div className="grid" style={{ gap: "10px" }}>
                {visibleMedalistCategories.map((category) => {
                  const displayedRegisteredCount =
                    Number.isFinite(category.officialRegisteredCount as number) &&
                    Number(category.officialRegisteredCount) >= 0
                      ? Number(category.officialRegisteredCount)
                      : category.athleteCount;
                  return (
                    <article key={category.categoryId} className="athlete-list-card">
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <strong>{category.categoryName}</strong>
                      <span className="arena-muted">{displayedRegisteredCount} inscritos</span>
                    </div>
                    <p className="arena-muted" style={{ margin: "6px 0 0" }}>
                      Medalhistas esperados: {String(category.expectedMedalists ?? "-")}
                      {" · "}
                      Confrontos calculados: {String(category.calculatedMatchesCount ?? category.publishedMatchesCount ?? 0)}
                      {" · "}
                      WO: {String(category.walkoverMatchesCount ?? 0)}
                      {" · "}
                      Confrontos jogados: {String(category.playedMatchesCount ?? category.publishedMatchesCount ?? 0)}
                    </p>
                    {category.medalists.length === 0 ? (
                      <p className="arena-muted" style={{ margin: "6px 0 0" }}>Pódio ainda não definido.</p>
                    ) : (
                      <ul style={{ margin: "8px 0 0", paddingLeft: "18px" }}>
                        {category.medalists.map((medalist) => (
                          <li key={`${category.categoryId}-${medalist.athleteId}-${medalist.position}-${medalist.medalha}`}>
                            {medalist.medalha === "ouro" ? "🥇" : medalist.medalha === "prata" ? "🥈" : "🥉"}{" "}
                            {medalist.athleteName}
                            {medalist.clubName ? ` · ${medalist.clubName}` : ""}
                          </li>
                        ))}
                      </ul>
                    )}
                    </article>
                  );
                })}
                {medalistCategories.length > medalistsVisible ? (
                  <div className="row" style={{ justifyContent: "center" }}>
                    <button type="button" onClick={() => setMedalistsVisible((current) => current + MEDALISTS_PAGE_SIZE)}>
                      Carregar mais categorias
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
        </Card>
      ) : null}
    </main>
  );
}


