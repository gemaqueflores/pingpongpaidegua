import assert from "node:assert/strict";
import test from "node:test";
import { inferAthleteFederationFromClub, shouldInferAthleteFederation } from "../src/pipeline/athlete-federation";

test("infer on COPA parses valid club suffix", () => {
  const result = inferAthleteFederationFromClub({
    eventLevel: "COPA",
    clubName: "ASSOCIACAO DE MESA - SP",
  });

  assert.deepEqual(result, {
    next: {
      stateCode: "SP",
      stateName: "Sao Paulo",
      region: "Regiao Sudeste",
    },
    source: "suffix",
  });
});

test("infer on NACIONAL with unicode separator", () => {
  const result = inferAthleteFederationFromClub({
    eventLevel: "NACIONAL",
    clubName: "CLUBE TESTE–RJ",
  });

  assert.deepEqual(result, {
    next: {
      stateCode: "RJ",
      stateName: "Rio de Janeiro",
      region: "Regiao Sudeste",
    },
    source: "suffix",
  });
});

test("does not infer for ESTADUAL", () => {
  const result = inferAthleteFederationFromClub({
    eventLevel: "ESTADUAL",
    clubName: "CLUBE TESTE - SP",
  });

  assert.deepEqual(result, {
    next: null,
  });
});

test("returns warning when club pattern is invalid", () => {
  const result = inferAthleteFederationFromClub({
    eventLevel: "COPA",
    clubName: "CLUBE SEM UF",
  });

  assert.equal(result.next, null);
  assert.equal(result.warning, "missing_pattern_or_invalid_uf");
});

test("preserves current valid data when same state is already set", () => {
  const result = inferAthleteFederationFromClub({
    eventLevel: "COPA",
    clubName: "CLUBE TESTE - MG",
    current: {
      stateCode: "MG",
      stateName: "Minas Gerais",
      region: "Regiao Sudeste",
    },
  });

  assert.deepEqual(result.next, {
    stateCode: "MG",
    stateName: "Minas Gerais",
    region: "Regiao Sudeste",
  });
  assert.equal(result.source, "suffix");
});

test("does not overwrite an already valid federation even if club suffix differs", () => {
  const result = inferAthleteFederationFromClub({
    eventLevel: "NACIONAL",
    clubName: "CLUBE TESTE - RJ",
    current: {
      stateCode: "SP",
      stateName: "Sao Paulo",
      region: "Regiao Sudeste",
    },
  });

  assert.deepEqual(result.next, {
    stateCode: "SP",
    stateName: "Sao Paulo",
    region: "Regiao Sudeste",
  });
  assert.equal(result.source, "suffix");
});

test("shouldInferAthleteFederation only for COPA/NACIONAL", () => {
  assert.equal(shouldInferAthleteFederation("COPA"), true);
  assert.equal(shouldInferAthleteFederation("NACIONAL"), true);
  assert.equal(shouldInferAthleteFederation("ESTADUAL"), false);
  assert.equal(shouldInferAthleteFederation(null), false);
});

test("aplica excecao APTM para UF PA", () => {
  const result = inferAthleteFederationFromClub({
    eventLevel: "NACIONAL",
    clubName: "ASSOCIAÇÃO PARAENSE DE TÊNIS DE MESA -APTM",
  });

  assert.deepEqual(result.next, {
    stateCode: "PA",
    stateName: "Para",
    region: "Regiao Norte",
  });
  assert.equal(result.source, "club_exception");
});
