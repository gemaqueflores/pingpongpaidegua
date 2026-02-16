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

test("buildEventScrapePolicy desliga auto apos pos-evento e respeita modo manual force", () => {
  const input = {
    inicioInscricoes: dt("2026-03-01T00:00:00.000Z"),
    fimInscricoes: dt("2026-03-10T23:59:59.000Z"),
    inicioRealizacao: dt("2026-03-20T08:00:00.000Z"),
    fimRealizacao: dt("2026-03-22T19:00:00.000Z"),
  };

  const postEvent = buildEventScrapePolicy(input, {
    now: dt("2026-03-30T12:00:00.000Z"),
  });
  assert.equal(postEvent.autoSchedule, false);
  assert.equal(postEvent.captureResultados, false);
  assert.equal(postEvent.fetchEliminatoria, false);
  assert.equal(postEvent.recommendedIntervalMs, null);

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
  assert.equal(manual.fetchEliminatoria, true);
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
  assert.equal(open.recommendedIntervalMs, 5 * 60 * 60 * 1000);

  const preEvent = buildEventScrapePolicy(input, { now: dt("2026-03-15T12:00:00.000Z") });
  assert.equal(preEvent.captureInscricoes, false);
  assert.equal(preEvent.captureGrupos, true);
  assert.equal(preEvent.captureResultados, false);
  assert.equal(preEvent.fetchEliminatoria, false);
  assert.equal(preEvent.recommendedIntervalMs, 3 * 60 * 60 * 1000);

  const inProgress = buildEventScrapePolicy(input, { now: dt("2026-03-21T12:00:00.000Z") });
  assert.equal(inProgress.captureInscricoes, false);
  assert.equal(inProgress.captureGrupos, false);
  assert.equal(inProgress.captureResultados, true);
  assert.equal(inProgress.fetchEliminatoria, true);
  assert.equal(inProgress.recommendedIntervalMs, 30 * 60 * 1000);
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
