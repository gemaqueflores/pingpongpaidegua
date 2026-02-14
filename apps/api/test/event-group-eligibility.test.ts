import assert from "node:assert/strict";
import test from "node:test";
import {
  canUseGroupSimulation,
  hasGroupStructureFromMatch,
  resolveUserEventStatus,
} from "../src/user/event-group-eligibility";

test("detecta estrutura oficial de grupos por fase ou rodada", () => {
  assert.equal(hasGroupStructureFromMatch({ phase: "GRUPOS", round: null }), true);
  assert.equal(hasGroupStructureFromMatch({ phase: "ELIMINATORIA", round: "Grupo 01" }), true);
  assert.equal(hasGroupStructureFromMatch({ phase: "RESULTADOS", round: "Semifinal" }), false);
});

test("resolve status de listagem para homepage", () => {
  assert.equal(resolveUserEventStatus({ concluido: true, eventSituation: "POS_EVENTO" }), "CONCLUIDO");
  assert.equal(
    resolveUserEventStatus({ concluido: false, eventSituation: "INSCRICOES_ABERTAS" }),
    "INSCRICOES_ABERTAS",
  );
  assert.equal(
    resolveUserEventStatus({ concluido: false, eventSituation: "POS_INSCRICOES_PRE_EVENTO" }),
    "INSCRICOES_ENCERRADAS",
  );
});

test("simulador so pode ser usado sem grupos definidos e em situacao elegivel", () => {
  assert.equal(
    canUseGroupSimulation({
      concluido: false,
      groupsDefined: false,
      eventSituation: "INSCRICOES_ABERTAS",
    }),
    true,
  );
  assert.equal(
    canUseGroupSimulation({
      concluido: false,
      groupsDefined: true,
      eventSituation: "INSCRICOES_ABERTAS",
    }),
    false,
  );
  assert.equal(
    canUseGroupSimulation({
      concluido: false,
      groupsDefined: false,
      eventSituation: "EM_ANDAMENTO",
    }),
    false,
  );
});

