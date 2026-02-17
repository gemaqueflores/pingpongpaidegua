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
import { ClubEfficiencyCareerPanel } from "../components/user/ClubEfficiencyCareerPanel";

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
