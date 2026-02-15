import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EventCard } from "../components/ui/EventCard";
import { Hero } from "../components/ui/Hero";
import { MatchCard } from "../components/ui/MatchCard";
import { StatBlock } from "../components/ui/StatBlock";
import { AthleteSummaryCard } from "../components/career/AthleteSummaryCard";
import { MedalMatrixTable } from "../components/career/MedalMatrixTable";

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
      eventId={1}
      cbtmEventId={5368}
      name="1TMB26"
      statusLabel="Inscricoes abertas"
      statusTone="open"
      periodLabel="21/02/2026 ate 22/02/2026"
      totalInscritos={196}
      totalCategorias={59}
      groupSimulationEligible
      groupsDefined={false}
      onOpen={() => undefined}
      onSimulate={() => undefined}
    />,
  );

  assert.match(html, /event-card/);
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
      share={{
        athleteKey: "ATLETA-EXEMPLO",
        stateCode: "PA",
        visibleColumns: [
          { key: "estadual", label: "Estadual" },
          { key: "copa", label: "Copa" },
          { key: "brasileirao", label: "Brasileirão" },
          { key: "open", label: "Open" },
          { key: "total", label: "Total" },
        ],
      }}
    />,
  );
  assert.match(html, /athlete-summary-card/);
  assert.match(html, /Aproveitamento/);
  assert.match(html, /Medalhas/);
});

test("Template export contract", async () => {
  const module = await import("../lib/share-image");

  assert.equal(typeof module.createShareImageBlob, "function");
  assert.equal(typeof module.createGroupSimulationShareImageBlob, "function");
  assert.equal(typeof module.downloadBlob, "function");
  assert.equal(typeof module.resolveCanvasSize, "function");
});
