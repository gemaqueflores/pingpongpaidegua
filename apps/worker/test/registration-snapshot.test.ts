import assert from "node:assert/strict";
import test from "node:test";
import {
  computeEventRegistrationPairRemovals,
  computeRegistrationCategoryRemovals,
  detectRegistrationCategoryMerge,
  shouldAllowDestructiveRegistrationSync,
  shouldSyncRegistrationSnapshot,
} from "../src/pipeline/registration-snapshot";

test("snapshot sync so ocorre em janela mutavel de inscricoes", () => {
  assert.equal(
    shouldSyncRegistrationSnapshot({
      eventConcluded: false,
      eventSituation: "INSCRICOES_ABERTAS",
      registrationCount: 10,
    }),
    true,
  );
  assert.equal(
    shouldSyncRegistrationSnapshot({
      eventConcluded: false,
      eventSituation: "EM_ANDAMENTO",
      registrationCount: 10,
    }),
    true,
  );
  assert.equal(
    shouldSyncRegistrationSnapshot({
      eventConcluded: false,
      eventSituation: "GRADES_PUBLICADAS_PRE_JOGO",
      registrationCount: 10,
    }),
    true,
  );
  assert.equal(
    shouldSyncRegistrationSnapshot({
      eventConcluded: true,
      eventSituation: "INSCRICOES_ABERTAS",
      registrationCount: 10,
    }),
    false,
  );
});

test("computeRegistrationCategoryRemovals remove categorias nao observadas mantendo protegidas", () => {
  const removals = computeRegistrationCategoryRemovals({
    currentCategoryIds: [1, 2, 3, 999],
    observedCategoryIds: new Set([2]),
    protectedCategoryIds: new Set([999]),
  });

  assert.deepEqual(removals.sort((a, b) => a - b), [1, 3]);
});

test("computeRegistrationCategoryRemovals nao remove quando categoria ainda observada", () => {
  const removals = computeRegistrationCategoryRemovals({
    currentCategoryIds: [10, 11],
    observedCategoryIds: new Set([10, 11]),
  });
  assert.deepEqual(removals, []);
});

test("computeEventRegistrationPairRemovals remove pares obsoletos mesmo para atleta ausente do snapshot", () => {
  const removals = computeEventRegistrationPairRemovals({
    currentPairs: [
      { athleteId: 1, categoryId: 10, registrationStatus: "INSCRITO" },
      { athleteId: 2, categoryId: 20, registrationStatus: "PRE_INSCRITO" },
    ],
    observedPairKeys: new Set(["1|10"]),
  });

  assert.deepEqual(removals, [{ athleteId: 2, categoryId: 20, registrationStatus: "PRE_INSCRITO" }]);
});

test("computeEventRegistrationPairRemovals preserva pares protegidos e remove pares sem status de inscricao", () => {
  const removals = computeEventRegistrationPairRemovals({
    currentPairs: [
      { athleteId: 1, categoryId: 10, registrationStatus: "INSCRITO" },
      { athleteId: 1, categoryId: 99, registrationStatus: "INSCRITO" },
      { athleteId: 2, categoryId: 20, registrationStatus: null },
    ],
    observedPairKeys: new Set(),
    protectedCategoryIds: new Set([99]),
  });

  assert.deepEqual(removals, [
    { athleteId: 1, categoryId: 10, registrationStatus: "INSCRITO" },
    { athleteId: 2, categoryId: 20, registrationStatus: null },
  ]);
});

test("detectRegistrationCategoryMerge confirma merge quando todos os atletas reaparecem em outras categorias", () => {
  const result = detectRegistrationCategoryMerge({
    missingCategoryId: 10,
    currentPairs: [
      { athleteId: 1, categoryId: 10, registrationStatus: "INSCRITO" },
      { athleteId: 2, categoryId: 10, registrationStatus: "INSCRITO" },
    ],
    observedPairs: [
      { athleteId: 1, categoryId: 20, registrationStatus: "INSCRITO" },
      { athleteId: 2, categoryId: 20, registrationStatus: "INSCRITO" },
      { athleteId: 3, categoryId: 20, registrationStatus: "INSCRITO" },
    ],
  });

  assert.equal(result.merged, true);
  assert.equal(result.migratedAthleteCount, 2);
  assert.equal(result.totalAthleteCount, 2);
  assert.deepEqual(result.targetCategoryIds, [20]);
});

test("detectRegistrationCategoryMerge nao confirma merge quando parte dos atletas nao reaparece", () => {
  const result = detectRegistrationCategoryMerge({
    missingCategoryId: 10,
    currentPairs: [
      { athleteId: 1, categoryId: 10, registrationStatus: "INSCRITO" },
      { athleteId: 2, categoryId: 10, registrationStatus: "INSCRITO" },
    ],
    observedPairs: [{ athleteId: 1, categoryId: 20, registrationStatus: "INSCRITO" }],
  });

  assert.equal(result.merged, false);
  assert.equal(result.migratedAthleteCount, 1);
  assert.equal(result.totalAthleteCount, 2);
  assert.deepEqual(result.targetCategoryIds, [20]);
});

test("shouldAllowDestructiveRegistrationSync bloqueia sincronizacao destrutiva com baixa cobertura", () => {
  const decision = shouldAllowDestructiveRegistrationSync({
    existingPairCount: 300,
    observedPairCount: 90,
  });

  assert.equal(decision.allow, false);
  assert.equal(decision.reason, "low-coverage");
});

test("shouldAllowDestructiveRegistrationSync bloqueia remocao massiva mesmo com cobertura suficiente", () => {
  const decision = shouldAllowDestructiveRegistrationSync({
    existingPairCount: 200,
    observedPairCount: 180,
    projectedRemovalCount: 120,
  });

  assert.equal(decision.allow, false);
  assert.equal(decision.reason, "high-removal-ratio");
});

test("shouldAllowDestructiveRegistrationSync permite sincronizacao normal", () => {
  const decision = shouldAllowDestructiveRegistrationSync({
    existingPairCount: 200,
    observedPairCount: 180,
    projectedRemovalCount: 20,
  });

  assert.equal(decision.allow, true);
  assert.equal(decision.reason, "ok");
});
