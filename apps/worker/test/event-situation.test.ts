import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEventScrapePolicy,
  computeEventSituation,
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

test("buildEventScrapePolicy respeita grace period e modo manual force", () => {
  const input = {
    inicioInscricoes: dt("2026-03-01T00:00:00.000Z"),
    fimInscricoes: dt("2026-03-10T23:59:59.000Z"),
    inicioRealizacao: dt("2026-03-20T08:00:00.000Z"),
    fimRealizacao: dt("2026-03-22T19:00:00.000Z"),
  };

  const inGrace = buildEventScrapePolicy(input, {
    now: dt("2026-03-23T12:00:00.000Z"),
    postEventGraceHours: 72,
  });
  assert.equal(inGrace.autoSchedule, true);
  assert.equal(inGrace.captureResultados, true);
  assert.equal(inGrace.fetchEliminatoria, true);

  const outGrace = buildEventScrapePolicy(input, {
    now: dt("2026-03-30T12:00:00.000Z"),
    postEventGraceHours: 48,
  });
  assert.equal(outGrace.autoSchedule, false);
  assert.equal(outGrace.captureResultados, false);
  assert.equal(outGrace.fetchEliminatoria, false);

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
});
