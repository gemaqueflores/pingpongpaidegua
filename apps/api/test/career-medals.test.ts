import assert from "node:assert/strict";
import test from "node:test";
import { buildCareerMedalTable, createEmptyMedalTable } from "../src/user/career-medals";

test("quadro de medalhas inicia com zeros", () => {
  assert.deepEqual(createEmptyMedalTable(), {
    ESTADUAL: { bronze: 0, prata: 0, ouro: 0 },
    COPA: { bronze: 0, prata: 0, ouro: 0 },
    NACIONAL: { bronze: 0, prata: 0, ouro: 0 },
  });
});

test("quadro de medalhas agrega ouro/prata/bronze por nivel", () => {
  const table = buildCareerMedalTable([
    {
      nivel: "ESTADUAL",
      performanceByCategory: [{ classification: { position: 1 } }, { classification: { position: 3 } }],
    },
    {
      nivel: "COPA",
      performanceByCategory: [{ classification: { position: 2 } }, { classification: { position: 2 } }],
    },
    {
      nivel: "NACIONAL",
      performanceByCategory: [{ classification: { position: 1 } }, { classification: { position: 1 } }],
    },
  ]);

  assert.deepEqual(table, {
    ESTADUAL: { bronze: 1, prata: 0, ouro: 1 },
    COPA: { bronze: 0, prata: 2, ouro: 0 },
    NACIONAL: { bronze: 0, prata: 0, ouro: 2 },
  });
});

test("quadro de medalhas ignora classificacao ausente e nivel nulo", () => {
  const table = buildCareerMedalTable([
    {
      nivel: null,
      performanceByCategory: [{ classification: { position: 1 } }],
    },
    {
      nivel: "ESTADUAL",
      performanceByCategory: [
        { classification: null },
        {},
        { classification: { position: null } },
        { classification: { position: 5 } },
      ],
    },
  ]);

  assert.deepEqual(table, {
    ESTADUAL: { bronze: 0, prata: 0, ouro: 0 },
    COPA: { bronze: 0, prata: 0, ouro: 0 },
    NACIONAL: { bronze: 0, prata: 0, ouro: 0 },
  });
});
