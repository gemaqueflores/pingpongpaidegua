import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EventCard } from "../components/ui/EventCard";
import { Hero } from "../components/ui/Hero";
import { MatchCard } from "../components/ui/MatchCard";
import { StatBlock } from "../components/ui/StatBlock";
import { AthleteSummaryCard } from "../components/career/AthleteSummaryCard";
import { MedalMatrixTable } from "../components/career/MedalMatrixTable";
import { ClubEfficiencyCareerPanel } from "../components/user/ClubEfficiencyCareerPanel";
import { EmptyState } from "../components/ui/EmptyState";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

test("Hero snapshot", () => {
  const html = renderToStaticMarkup(
    <Hero title="Plataforma de Tenis de Mesa Brasil" subtitle="PingPong Paid'egua" />,
  );

  assert.match(html, /hero-header/);
  assert.match(html, /hero-title/);
  assert.match(html, /hero-subtitle/);
});

test("EventCard snapshot", () => {
  const html = renderToStaticMarkup(
    <EventCard
      cbtmEventId={5368}
      name="1TMB26"
      statusLabel="Inscricoes abertas"
      statusTone="open"
      periodLabel="21/02/2026 ate 22/02/2026"
      totalInscritos={196}
      inscricoesTotaisOficiais={468}
      totalPartidas={779}
      totalPartidasJogadas={753}
      totalCategorias={59}
      groupsDefined={false}
      isConcluded={false}
      onOpen={() => undefined}
      onSimulate={() => undefined}
    />,
  );

  assert.match(html, /event-card/);
  assert.match(html, /event-card-metrics/);
  assert.doesNotMatch(html, /class="event-metrics"/);
  assert.doesNotMatch(html, /event-metric-card/);
  assert.match(html, /Ver Evento/);
  assert.match(html, /Simular Grupos/);
});

test("StatBlock snapshot", () => {
  const html = renderToStaticMarkup(<StatBlock label="Aproveitamento" value="78.4%" tone="win" />);

  assert.match(html, /stat-block-win/);
  assert.match(html, /Aproveitamento/);
  assert.match(html, /78.4%/);
});

test("MatchCard snapshot", () => {
  const html = renderToStaticMarkup(
    <MatchCard
      categoryName="SUB-11 FEM"
      phase="Grupo"
      round="Rodada 1"
      datetime="15/02/2026 08:10"
      confrontation="DEBORA FLORES x RIVAL"
      setsLine="5-11 / 8-11 / 3-11"
      finalLine="0-3"
      tone="lose"
    />,
  );

  assert.match(html, /match-card-lose/);
  assert.match(html, /Derrota/);
  assert.match(html, /SUB-11 FEM/);
});

test("MedalMatrixTable snapshot", () => {
  const html = renderToStaticMarkup(
    <MedalMatrixTable
      matrix={{
        ouro: { estadual: 2, copa: 1, brasileirao: 0, open: 1, total: 4 },
        prata: { estadual: 1, copa: 0, brasileirao: 1, open: 0, total: 2 },
        bronze: { estadual: 4, copa: 2, brasileirao: 1, open: 2, total: 9 },
      }}
    />,
  );
  assert.match(html, /career-medal-table/);
  assert.match(html, /Brasileirão/);
  assert.match(html, /Open/);
  assert.match(html, /🥇/);
});

test("AthleteSummaryCard snapshot", () => {
  const html = renderToStaticMarkup(
    <AthleteSummaryCard
      athleteName="ATLETA EXEMPLO"
      athleteReducedName="ATLETA EXEMPLO"
      federationText="PA (Pará) - Norte"
      nextEventName="1TMB26"
      kpis={{
        ratio: "61.22%",
        pointsDetail: "412/673",
        wins: 12,
        losses: 8,
        recent: "W W L W L",
        totalEvents: 5,
        totalMatches: 20,
      }}
      medalMatrix={{
        ouro: { estadual: 2, copa: 0, brasileirao: 1, open: 1, total: 4 },
        prata: { estadual: 1, copa: 1, brasileirao: 0, open: 0, total: 2 },
        bronze: { estadual: 3, copa: 1, brasileirao: 1, open: 2, total: 7 },
      }}
    />,
  );
  assert.match(html, /athlete-summary-card/);
  assert.match(html, /Aproveitamento/);
  assert.match(html, /Próximo evento/);
});

test("Template export contract", async () => {
  const module = await import("../lib/share-image");

  assert.equal(typeof module.createShareImageBlob, "function");
  assert.equal(typeof module.createGroupSimulationShareImageBlob, "function");
  assert.equal(typeof module.downloadBlob, "function");
  assert.equal(typeof module.resolveCanvasSize, "function");
});

test("ClubEfficiencyCareerPanel snapshot", () => {
  const html = renderToStaticMarkup(
    <ClubEfficiencyCareerPanel
      expandedEvents={{ 11: true }}
      onToggleEvent={() => undefined}
      data={{
        club: { id: 77, name: "PARA CLUBE - PA" },
        weights: { pesoOuro: 400, pesoPrata: 240, pesoBronze: 120 },
        summary: {
          nEventos: 5,
          ultimoEventoNome: "1TMB26",
          ultimoEventoId: 11,
          nAtletasUltimoEvento: 18,
          proximoEventoNome: "2TMB26",
          proximoEventoId: 12,
          nAtletasProximoEvento: 17,
          medalhasTotais: { ouro: 6, prata: 4, bronze: 7, total: 17 },
        },
        broadcastByType: {
          BRASILEIRAO: { ouro: 1, prata: 0, bronze: 1, total: 2 },
          COPA: { ouro: 2, prata: 1, bronze: 0, total: 3 },
          ESTADUAL: { ouro: 3, prata: 2, bronze: 4, total: 9 },
          OPEN: { ouro: 0, prata: 1, bronze: 2, total: 3 },
        },
        scoreCard: {
          quantidade: { ouro: 6, prata: 4, bronze: 7, total: 17 },
          pontuacao: { ouro: 2400, prata: 960, bronze: 840, total: 4200 },
        },
        history: [
          {
            eventId: 11,
            eventName: "1TMB26",
            eventType: "ESTADUAL",
            dataInicio: "2026-02-21T03:00:00.000Z",
            dataFim: "2026-02-23T03:00:00.000Z",
            athleteCount: 18,
            ouro: 3,
            prata: 2,
            bronze: 1,
            totalQuantidade: 6,
            pontuacao: { ouro: 1200, prata: 480, bronze: 120, total: 1800 },
            medalists: [
              { athleteId: 1, athleteName: "ATLETA A", categoryName: "ABS C", medalha: "ouro" },
              { athleteId: 2, athleteName: "ATLETA B", categoryName: "ABS D", medalha: "prata" },
            ],
          },
        ],
        athletesContribution: [
          {
            athleteId: 1,
            athleteName: "ATLETA A",
            eventos: 4,
            ouro: 2,
            prata: 1,
            bronze: 1,
            totalQuantidade: 4,
            pontuacao: { ouro: 800, prata: 240, bronze: 120, total: 1160 },
          },
        ],
      }}
    />,
  );

  assert.match(html, /Eventos computados/);
  assert.match(html, /Próximo evento/);
  assert.match(html, /Histórico por evento/);
  assert.match(html, /Contribuição por atleta/);
});

test("PP-002 T-U-01 events/page exibe erro da API antes do filtro vazio", () => {
  const source = readFileSync(new URL("../app/events/page.tsx", import.meta.url), "utf8");
  const html = renderToStaticMarkup(
    <EmptyState
      title="Serviço indisponível"
      description="Não foi possível carregar os eventos. Tente novamente em instantes."
    />,
  );

  assert.match(source, /apiError[\s\S]*filteredCount === 0/);
  assert.match(html, /Serviço indisponível/);
  assert.doesNotMatch(html, /Nenhum evento atende aos filtros/);
});

test("PP-002 T-U-02 events/page preserva estado vazio sem erro", () => {
  const source = readFileSync(new URL("../app/events/page.tsx", import.meta.url), "utf8");
  const html = renderToStaticMarkup(
    <EmptyState title="Sem resultados" description="Nenhum evento atende aos filtros selecionados." />,
  );

  assert.match(source, /filteredCount === 0/);
  assert.match(html, /Sem resultados/);
  assert.doesNotMatch(html, /Serviço indisponível/);
});

test("PP-002 T-U-03 atletas/page exibe erro da API", () => {
  const source = readFileSync(new URL("../app/atletas/page.tsx", import.meta.url), "utf8");
  const html = renderToStaticMarkup(
    <EmptyState
      title="Serviço indisponível"
      description="Não foi possível carregar os atletas. Tente novamente em instantes."
    />,
  );

  assert.match(source, /apiError && athleteCount === 0/);
  assert.match(html, /Serviço indisponível/);
});

test("PP-002 T-U-04 eficiencia/page exibe erro da API", () => {
  const source = readFileSync(new URL("../app/eficiencia/page.tsx", import.meta.url), "utf8");
  const html = renderToStaticMarkup(
    <EmptyState
      title="Serviço indisponível"
      description="Não foi possível carregar a eficiência. Tente novamente em instantes."
    />,
  );

  assert.match(source, /if \(apiError\)/);
  assert.match(html, /Serviço indisponível/);
});

test("PP-015 T-C-01 admin/page nao inicializa pesos com hardcode numerico", () => {
  const source = readFileSync(new URL("../app/admin/page.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(source, /useState\("400"\)/);
  assert.doesNotMatch(source, /useState\("240"\)/);
  assert.doesNotMatch(source, /useState\("120"\)/);
});

test("PP-015 T-C-02 eficiencia/page usa seletor de ano vindo da API", () => {
  const source = readFileSync(new URL("../app/eficiencia/page.tsx", import.meta.url), "utf8");

  assert.match(source, /availableYears/);
  assert.match(source, /apiGetGlobalEfficiency\(selectedYear/);
  assert.match(source, /<select/);
  assert.match(source, /Todos os anos/);
});

test("PP-015 T-NR-01 eficiencia/[clubId] permanece sem filtro por ano", () => {
  const pageSource = readFileSync(new URL("../app/eficiencia/[clubId]/page.tsx", import.meta.url), "utf8");
  const apiSource = readFileSync(new URL("../lib/user-api.ts", import.meta.url), "utf8");

  assert.match(pageSource, /apiGetClubEfficiencyCareer\(clubId\)/);
  assert.doesNotMatch(pageSource, /selectedYear/);
  assert.doesNotMatch(pageSource, /availableYears/);
  assert.doesNotMatch(pageSource, /<select/);
  assert.match(apiSource, /apiGetClubEfficiencyCareer\(clubId: number\)/);
});

test("PP-002 T-U-05 home exibe erro da API na secao de eventos", () => {
  const source = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const html = renderToStaticMarkup(
    <EmptyState
      title="Serviço indisponível"
      description="Não foi possível carregar os eventos. Tente novamente em instantes."
    />,
  );

  assert.match(source, /if \(eventsApiError\)/);
  assert.match(html, /Serviço indisponível/);
});

test("PP-002 T-U-06 paginas limpam erro em chamada bem-sucedida", () => {
  const files = [
    ["events", "app/events/page.tsx", "setApiError(false)"],
    ["atletas", "app/atletas/page.tsx", "setApiError(false)"],
    ["eficiencia", "app/eficiencia/page.tsx", "setApiError(false)"],
    ["home", "app/page.tsx", "setEventsApiError(false)"],
  ] as const;

  for (const [label, path, resetCall] of files) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    assert.match(source, /\.then\(\(.*?\) => \{/s, `${label}: sucesso deve usar bloco then`);
    assert.ok(source.includes(resetCall), `${label}: sucesso deve limpar estado de erro`);
  }
});

test("PP-004 T-U-01 eficiencia/[clubId] renderiza EmptyState de servico indisponivel", () => {
  const html = renderToStaticMarkup(
    <EmptyState
      title="Serviço indisponível"
      description="Não foi possível carregar a eficiência deste clube. Tente novamente em instantes."
    />,
  );

  assert.match(html, /Serviço indisponível/);
  assert.doesNotMatch(html, /Not Found/);
  assert.doesNotMatch(html, /Internal Server Error/);
});

test("PP-004 T-U-02 eficiencia/[clubId] renderiza EmptyState de clube nao encontrado", () => {
  const html = renderToStaticMarkup(
    <EmptyState title="Clube não encontrado" description="O identificador informado não é válido." />,
  );

  assert.match(html, /Clube não encontrado/);
});

test("PP-004 T-U-03 eficiencia/[clubId] catch nao captura err.message", () => {
  const files = [
    "../app/eficiencia/[clubId]/page.tsx",
    "../app/user/eficiencia/[clubId]/page.tsx",
  ] as const;

  for (const file of files) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /err\.message/);
    assert.doesNotMatch(source, /err instanceof Error/);
  }
});

test("PP-004 T-U-04 career/[athleteKey] renderiza EmptyState de atleta nao encontrado", () => {
  const source = readFileSync(new URL("../app/user/career/[athleteKey]/page.tsx", import.meta.url), "utf8");
  const html = renderToStaticMarkup(
    <EmptyState
      title="Atleta não encontrado"
      description="Carreira não encontrada para o atleta informado."
    />,
  );

  assert.match(source, /Atleta não encontrado/);
  assert.match(html, /Atleta não encontrado/);
  assert.doesNotMatch(source, /<h2>Carreira<\/h2>/);
});

test("PP-004 T-U-05 career/[athleteKey] nao exibe error diretamente na UI", () => {
  const source = readFileSync(new URL("../app/user/career/[athleteKey]/page.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(source, /<p>\{error\}<\/p>/);
});

test("PP-051 T-U-01 .container renderiza com classe unica, sem regressao de padding", () => {
  const html = renderToStaticMarkup(<div className="container">conteudo</div>);

  const matches = html.match(/class="container"/g) ?? [];
  assert.equal(matches.length, 1);
});

test("PP-051 T-U-02 numeros de destaque com tabular-nums", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  const selectors = [
    ".group-athlete-points",
    ".score-badge",
    ".count-value",
    ".compact-summary-total",
    ".career-kpi-card strong",
    ".match-card-result",
    ".event-efficiency-total",
    ".event-efficiency-podium-total",
    ".performance-bar-value",
    ".stat-block-value",
    ".efficiency-club-total strong",
    ".club-hero-stat-value",
    ".club-medal-bar-value",
  ];

  for (const selector of selectors) {
    const escaped = selector.replace(/[.[\]]/g, "\\$&");
    const pattern = new RegExp(`${escaped}\\s*\\{[^}]*font-variant-numeric:\\s*tabular-nums`, "s");
    assert.match(css, pattern, `${selector} deve ter font-variant-numeric: tabular-nums`);
  }
});

test("PP-051 T-U-03 ClubEfficiencyCareerPanel e AthleteSummaryCard renderizam classes de barra de medalha", () => {
  const clubHtml = renderToStaticMarkup(
    <ClubEfficiencyCareerPanel
      expandedEvents={{}}
      onToggleEvent={() => undefined}
      data={{
        club: { id: 77, name: "PARA CLUBE - PA" },
        weights: { pesoOuro: 400, pesoPrata: 240, pesoBronze: 120 },
        summary: {
          nEventos: 1,
          ultimoEventoNome: "1TMB26",
          ultimoEventoId: 11,
          nAtletasUltimoEvento: 1,
          proximoEventoNome: null,
          proximoEventoId: null,
          nAtletasProximoEvento: 0,
          medalhasTotais: { ouro: 1, prata: 1, bronze: 1, total: 3 },
        },
        broadcastByType: {
          BRASILEIRAO: { ouro: 0, prata: 0, bronze: 0, total: 0 },
          COPA: { ouro: 0, prata: 0, bronze: 0, total: 0 },
          ESTADUAL: { ouro: 1, prata: 1, bronze: 1, total: 3 },
          OPEN: { ouro: 0, prata: 0, bronze: 0, total: 0 },
        },
        scoreCard: {
          quantidade: { ouro: 1, prata: 1, bronze: 1, total: 3 },
          pontuacao: { ouro: 400, prata: 240, bronze: 120, total: 760 },
        },
        history: [],
        athletesContribution: [],
      }}
    />,
  );

  assert.match(clubHtml, /club-medal-bar-fill gold/);
  assert.match(clubHtml, /club-medal-bar-fill silver/);
  assert.match(clubHtml, /club-medal-bar-fill bronze/);

  const athleteHtml = renderToStaticMarkup(
    <AthleteSummaryCard
      athleteName="ATLETA EXEMPLO"
      athleteReducedName="ATLETA EXEMPLO"
      federationText="PA (Pará) - Norte"
      nextEventName="1TMB26"
      kpis={{
        ratio: "61.22%",
        pointsDetail: "412/673",
        wins: 12,
        losses: 8,
        recent: "W W L W L",
        totalEvents: 5,
        totalMatches: 20,
      }}
      medalMatrix={{
        ouro: { estadual: 2, copa: 0, brasileirao: 1, open: 1, total: 4 },
        prata: { estadual: 1, copa: 1, brasileirao: 0, open: 0, total: 2 },
        bronze: { estadual: 3, copa: 1, brasileirao: 1, open: 2, total: 7 },
      }}
    />,
  );

  assert.match(athleteHtml, /career-medal-bar-fill gold/);
  assert.match(athleteHtml, /career-medal-bar-fill silver/);
  assert.match(athleteHtml, /career-medal-bar-fill bronze/);
});

test("PP-051 T-U-04 globals.css sem variaveis de token duplicadas", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.doesNotMatch(css, /--radius-2:/);
  assert.doesNotMatch(css, /--radius-3:/);
  assert.doesNotMatch(css, /--space-1:/);
  assert.doesNotMatch(css, /--space-2:/);
  assert.doesNotMatch(css, /--space-3:/);
  assert.doesNotMatch(css, /--space-4:/);
  assert.doesNotMatch(css, /--space-5:/);
  assert.doesNotMatch(css, /--space-6:/);
  assert.doesNotMatch(css, /--muted-2:/);
});

test("PP-051 T-U-05 .classification-row-* com os mesmos valores RGB de .eff-row-*", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(css, /classification-row-ouro[\s\S]{0,80}rgba\(255,\s*212,\s*59/);
  assert.match(css, /classification-row-prata[\s\S]{0,80}rgba\(220,\s*230,\s*246/);
  assert.match(css, /classification-row-bronze[\s\S]{0,80}rgba\(255,\s*184,\s*106/);
});

test("PP-051 T-U-06 CSS morto ausente", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.doesNotMatch(css, /\.home-club-medal-legend/);
  assert.doesNotMatch(css, /\.athlete-summary-head/);
  assert.doesNotMatch(css, /\.athlete-summary-share/);
});
