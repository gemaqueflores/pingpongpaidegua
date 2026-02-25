import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEventScrapePolicy,
  computeEventSituation,
  shouldRunEventAutoScrape,
} from "@cbtm/shared";

function dt(value: string): Date {
  return new Date(value);
}

test("computeEventSituation retorna DRAFT quando datas minimas faltam", () => {
  const situation = computeEventSituation({
    inicioInscricoes: dt("2026-03-01T00:00:00.000Z"),
    fimInscricoes: null,
    inicioRealizacao: dt("2026-04-01T00:00:00.000Z"),
    fimRealizacao: dt("2026-04-05T00:00:00.000Z"),
  });

  assert.equal(situation, "DRAFT");
});

test("computeEventSituation cobre janela pre, inscricoes, pre-evento, andamento e pos-evento", () => {
  const input = {
    inicioInscricoes: dt("2026-03-01T00:00:00.000Z"),
    fimInscricoes: dt("2026-03-10T23:59:59.000Z"),
    inicioRealizacao: dt("2026-03-20T08:00:00.000Z"),
    fimRealizacao: dt("2026-03-22T19:00:00.000Z"),
  };

  assert.equal(computeEventSituation(input, dt("2026-02-25T12:00:00.000Z")), "PRE_INSCRICOES");
  assert.equal(computeEventSituation(input, dt("2026-03-05T12:00:00.000Z")), "INSCRICOES_ABERTAS");
  assert.equal(computeEventSituation(input, dt("2026-03-15T12:00:00.000Z")), "POS_INSCRICOES_PRE_EVENTO");
  assert.equal(computeEventSituation(input, dt("2026-03-21T12:00:00.000Z")), "EM_ANDAMENTO");
  assert.equal(computeEventSituation(input, dt("2026-03-23T12:00:00.000Z")), "POS_EVENTO");
});

test("computeEventSituation identifica grades publicadas no pre-evento quando ha confrontos sem resultado", () => {
  const input = {
    inicioInscricoes: dt("2026-03-01T00:00:00.000Z"),
    fimInscricoes: dt("2026-03-10T23:59:59.000Z"),
    inicioRealizacao: dt("2026-03-20T08:00:00.000Z"),
    fimRealizacao: dt("2026-03-22T19:00:00.000Z"),
    hasPublishedMatches: true,
    hasPublishedResults: false,
  };

  assert.equal(computeEventSituation(input, dt("2026-03-15T12:00:00.000Z")), "GRADES_PUBLICADAS_PRE_JOGO");
});

test("buildEventScrapePolicy desliga auto apos pos-evento e respeita modo manual force", () => {
  const input = {
    inicioInscricoes: dt("2026-03-01T00:00:00.000Z"),
    fimInscricoes: dt("2026-03-10T23:59:59.000Z"),
    inicioRealizacao: dt("2026-03-20T08:00:00.000Z"),
    fimRealizacao: dt("2026-03-22T19:00:00.000Z"),
  };

  const postEventImmediate = buildEventScrapePolicy(input, {
    now: dt("2026-03-22T22:00:00.000Z"),
  });
  assert.equal(postEventImmediate.autoSchedule, true);
  assert.equal(postEventImmediate.captureResultados, true);
  assert.equal(postEventImmediate.fetchEliminatoria, false);
  assert.equal(postEventImmediate.recommendedIntervalMs, 2 * 60 * 60 * 1000);

  const postEventStabilized = buildEventScrapePolicy(input, {
    now: dt("2026-03-30T12:00:00.000Z"),
  });
  assert.equal(postEventStabilized.autoSchedule, false);
  assert.equal(postEventStabilized.captureResultados, false);
  assert.equal(postEventStabilized.fetchEliminatoria, false);
  assert.equal(postEventStabilized.recommendedIntervalMs, null);

  const manual = buildEventScrapePolicy(
    {
      inicioInscricoes: null,
      fimInscricoes: null,
      inicioRealizacao: null,
      fimRealizacao: null,
    },
    {
      now: dt("2026-01-01T00:00:00.000Z"),
      isManualForce: true,
    },
  );
  assert.equal(manual.autoSchedule, true);
  assert.equal(manual.captureInscricoes, true);
  assert.equal(manual.captureResultados, true);
  assert.equal(manual.fetchEliminatoria, false);
  assert.equal(manual.recommendedIntervalMs, 0);
});

test("buildEventScrapePolicy segue ciclo de vida para blocos de captura", () => {
  const input = {
    inicioInscricoes: dt("2026-03-01T00:00:00.000Z"),
    fimInscricoes: dt("2026-03-10T23:59:59.000Z"),
    inicioRealizacao: dt("2026-03-20T08:00:00.000Z"),
    fimRealizacao: dt("2026-03-22T19:00:00.000Z"),
  };

  const open = buildEventScrapePolicy(input, { now: dt("2026-03-05T12:00:00.000Z") });
  assert.equal(open.captureInscricoes, true);
  assert.equal(open.captureGrupos, false);
  assert.equal(open.captureResultados, false);
  assert.equal(open.fetchEliminatoria, false);
  assert.equal(open.recommendedIntervalMs, 6 * 60 * 60 * 1000);

  const preEvent = buildEventScrapePolicy(input, { now: dt("2026-03-15T12:00:00.000Z") });
  assert.equal(preEvent.captureInscricoes, true);
  assert.equal(preEvent.captureGrupos, true);
  assert.equal(preEvent.captureResultados, true);
  assert.equal(preEvent.fetchEliminatoria, false);
  assert.equal(preEvent.recommendedIntervalMs, 2 * 60 * 60 * 1000);

  const inProgress = buildEventScrapePolicy(input, { now: dt("2026-03-21T12:00:00.000Z") });
  assert.equal(inProgress.captureInscricoes, false);
  assert.equal(inProgress.captureGrupos, false);
  assert.equal(inProgress.captureResultados, true);
  assert.equal(inProgress.fetchEliminatoria, false);
  assert.equal(inProgress.recommendedIntervalMs, 20 * 60 * 1000);

  const publishedGrids = buildEventScrapePolicy(
    {
      ...input,
      hasPublishedMatches: true,
      hasPublishedResults: false,
    },
    { now: dt("2026-03-15T12:00:00.000Z") },
  );
  assert.equal(publishedGrids.captureInscricoes, false);
  assert.equal(publishedGrids.captureGrupos, true);
  assert.equal(publishedGrids.captureResultados, true);
  assert.equal(publishedGrids.fetchEliminatoria, false);
  assert.equal(publishedGrids.recommendedIntervalMs, 45 * 60 * 1000);
});

test("buildEventScrapePolicy aplica janela de inscricoes encerradas e definicao de confrontos", () => {
  const input = {
    inicioInscricoes: dt("2026-03-01T00:00:00.000Z"),
    fimInscricoes: dt("2026-03-10T23:59:59.000Z"),
    inicioRealizacao: dt("2026-03-20T08:00:00.000Z"),
    fimRealizacao: dt("2026-03-22T19:00:00.000Z"),
  };

  const closedRegistrations = buildEventScrapePolicy(input, { now: dt("2026-03-11T12:00:00.000Z") });
  assert.equal(closedRegistrations.captureInscricoes, true);
  assert.equal(closedRegistrations.captureGrupos, false);
  assert.equal(closedRegistrations.captureResultados, false);
  assert.equal(closedRegistrations.fetchEliminatoria, false);
  assert.equal(closedRegistrations.recommendedIntervalMs, 6 * 60 * 60 * 1000);
  assert.equal(closedRegistrations.reason, "inscricoes-encerradas-sanitizacao");

  const matchDefinition = buildEventScrapePolicy(input, { now: dt("2026-03-18T12:00:00.000Z") });
  assert.equal(matchDefinition.captureInscricoes, false);
  assert.equal(matchDefinition.captureGrupos, true);
  assert.equal(matchDefinition.captureResultados, true);
  assert.equal(matchDefinition.fetchEliminatoria, false);
  assert.equal(matchDefinition.reason, "definicao-de-confrontos");

  const groupFormation = buildEventScrapePolicy(input, { now: dt("2026-03-14T12:00:00.000Z") });
  assert.equal(groupFormation.captureInscricoes, true);
  assert.equal(groupFormation.captureGrupos, true);
  assert.equal(groupFormation.captureResultados, true);
  assert.equal(groupFormation.fetchEliminatoria, false);
  assert.equal(groupFormation.reason, "formacao-de-grupos");
});

test("buildEventScrapePolicy usa janela pre-evento 16h-07h com intervalo de 90 minutos", () => {
  const input = {
    inicioInscricoes: dt("2026-03-01T00:00:00.000Z"),
    fimInscricoes: dt("2026-03-10T23:59:59.000Z"),
    inicioRealizacao: dt("2026-03-20T08:00:00.000Z"),
    fimRealizacao: dt("2026-03-22T19:00:00.000Z"),
  };

  const inWindow = buildEventScrapePolicy(input, { now: dt("2026-03-19T20:00:00.000Z") });
  assert.equal(inWindow.captureInscricoes, false);
  assert.equal(inWindow.captureGrupos, true);
  assert.equal(inWindow.captureResultados, true);
  assert.equal(inWindow.fetchEliminatoria, false);
  assert.equal(inWindow.recommendedIntervalMs, 90 * 60 * 1000);
  assert.equal(inWindow.reason, "pre-evento-confrontos-90min");

  const outOfWindow = buildEventScrapePolicy(input, { now: dt("2026-03-20T11:00:00.000Z") });
  assert.notEqual(outOfWindow.reason, "pre-evento-confrontos-90min");
});

test("shouldRunEventAutoScrape aplica intervalo recomendado", () => {
  const policy = {
    autoSchedule: true,
    captureInscricoes: true,
    captureGrupos: false,
    captureResultados: false,
    fetchEliminatoria: false,
    recommendedIntervalMs: 60 * 60 * 1000,
    reason: "inscricoes-abertas",
  } as const;

  const now = dt("2026-03-05T12:00:00.000Z");
  const dueWithoutLast = shouldRunEventAutoScrape(null, policy, now);
  assert.equal(dueWithoutLast.due, true);

  const tooSoon = shouldRunEventAutoScrape(dt("2026-03-05T11:30:00.000Z"), policy, now);
  assert.equal(tooSoon.due, false);
  assert.equal(tooSoon.waitMs, 30 * 60 * 1000);

  const due = shouldRunEventAutoScrape(dt("2026-03-05T10:00:00.000Z"), policy, now);
  assert.equal(due.due, true);
  assert.equal(due.waitMs, 0);
});
