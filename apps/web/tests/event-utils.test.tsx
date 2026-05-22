import assert from "node:assert/strict";
import test from "node:test";
import {
  formatDate,
  inferEventType,
  resolveDisplayStatus,
  sortEventsByStatusAndDate,
} from "../lib/event-utils";
import type { UserEventRow } from "../lib/user-api";

function makeEvent(overrides: Partial<UserEventRow> = {}): UserEventRow {
  return {
    id: 1,
    cbtmEventId: 5368,
    nome: "Campeonato",
    nivel: null,
    inicioInscricoes: null,
    fimInscricoes: null,
    inicioRealizacao: null,
    fimRealizacao: null,
    dataInicio: null,
    dataFim: null,
    concluido: false,
    lastScrapeAt: null,
    situacaoComputada: "INSCRICOES_ABERTAS",
    totalCategorias: 0,
    totalInscritos: 0,
    totalTecnicos: 0,
    groupsDefined: false,
    userStatus: "INSCRICOES_ABERTAS",
    groupSimulationEligible: false,
    ...overrides,
  };
}

test("PP-003 T-U-01 resolveDisplayStatus retorna CONCLUIDO quando concluido=true", () => {
  const event = makeEvent({
    concluido: true,
    userStatus: "INSCRICOES_ABERTAS",
    situacaoComputada: "EM_ANDAMENTO",
  });

  assert.equal(resolveDisplayStatus(event), "CONCLUIDO");
});

test("PP-003 T-U-02 resolveDisplayStatus retorna GRUPOS_DIVULGADOS quando grades publicadas", () => {
  const event = makeEvent({
    situacaoComputada: "GRADES_PUBLICADAS_PRE_JOGO",
    concluido: false,
    userStatus: "INSCRICOES_ABERTAS",
  });

  assert.equal(resolveDisplayStatus(event), "GRUPOS_DIVULGADOS");
});

test("PP-003 T-U-03 inferEventType retorna BRASILEIRAO para nivel NACIONAL", () => {
  assert.equal(inferEventType(makeEvent({ nivel: "NACIONAL" })), "BRASILEIRAO");
});

test("PP-003 T-U-04 inferEventType usa heuristica de nome quando nivel=null", () => {
  assert.equal(inferEventType(makeEvent({ nivel: null, nome: "Copa Norte de Tenis de Mesa" })), "COPA");
});

test("PP-003 T-U-05 sortEventsByStatusAndDate ordena abertos antes de concluidos", () => {
  const concluded = makeEvent({
    id: 1,
    nome: "Evento concluido",
    userStatus: "CONCLUIDO",
    dataInicio: "2025-01-01T03:00:00.000Z",
  });
  const open = makeEvent({
    id: 2,
    nome: "Evento aberto",
    userStatus: "INSCRICOES_ABERTAS",
    dataInicio: "2025-06-01T03:00:00.000Z",
  });

  const sorted = sortEventsByStatusAndDate([concluded, open]);

  assert.equal(sorted[0]?.id, 2);
});

test("PP-003 T-U-06 formatDate retorna '-' para null", () => {
  assert.equal(formatDate(null), "-");
});
