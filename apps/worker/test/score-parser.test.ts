import test from "node:test";
import assert from "node:assert/strict";
import { parseScoreRaw } from "../src/pipeline/score-parser";

test("parse final simples com x", () => {
  const parsed = parseScoreRaw("3x1");
  assert.deepEqual(parsed, {
    final: { setsA: 3, setsB: 1 },
    sets: [],
  });
});

test("parse final simples com X e espacos", () => {
  const parsed = parseScoreRaw("3 X 2");
  assert.deepEqual(parsed, {
    final: { setsA: 3, setsB: 2 },
    sets: [],
  });
});

test("parse final com traço e sets entre parenteses", () => {
  const parsed = parseScoreRaw("3-0 (11-7, 11-9, 11-8)");
  assert.deepEqual(parsed, {
    final: { setsA: 3, setsB: 0 },
    sets: [
      { set: 1, a: 11, b: 7 },
      { set: 2, a: 11, b: 9 },
      { set: 3, a: 11, b: 8 },
    ],
  });
});

test("parse sets com separador barra", () => {
  const parsed = parseScoreRaw("3 x 2 (11/7, 9/11, 11/9, 8/11, 11/8)");
  assert.deepEqual(parsed, {
    final: { setsA: 3, setsB: 2 },
    sets: [
      { set: 1, a: 11, b: 7 },
      { set: 2, a: 9, b: 11 },
      { set: 3, a: 11, b: 9 },
      { set: 4, a: 8, b: 11 },
      { set: 5, a: 11, b: 8 },
    ],
  });
});

test("infere final a partir dos sets quando nao ha placar final", () => {
  const parsed = parseScoreRaw("11-7, 9-11, 11-9, 11-4");
  assert.deepEqual(parsed, {
    final: { setsA: 3, setsB: 1 },
    sets: [
      { set: 1, a: 11, b: 7 },
      { set: 2, a: 9, b: 11 },
      { set: 3, a: 11, b: 9 },
      { set: 4, a: 11, b: 4 },
    ],
  });
});

test("aceita travessao unicode no placar final e nos sets", () => {
  const parsed = parseScoreRaw("3 – 1 (11–7; 9–11; 11–9; 11–4)");
  assert.deepEqual(parsed, {
    final: { setsA: 3, setsB: 1 },
    sets: [
      { set: 1, a: 11, b: 7 },
      { set: 2, a: 9, b: 11 },
      { set: 3, a: 11, b: 9 },
      { set: 4, a: 11, b: 4 },
    ],
  });
});

test("ignora token invalido no meio dos sets", () => {
  const parsed = parseScoreRaw("3x1 (11-7, 9-11, -, 11-4)");
  assert.deepEqual(parsed, {
    final: { setsA: 3, setsB: 1 },
    sets: [
      { set: 1, a: 11, b: 7 },
      { set: 2, a: 9, b: 11 },
      { set: 3, a: 11, b: 4 },
    ],
  });
});

test("retorna null para WO sem pontos", () => {
  const parsed = parseScoreRaw("W.O.");
  assert.equal(parsed, null);
});

test("aceita sets 0-0 quando informados explicitamente", () => {
  const parsed = parseScoreRaw("3x0 (0-0, 0-0, 0-0)");
  assert.deepEqual(parsed, {
    final: { setsA: 3, setsB: 0 },
    sets: [
      { set: 1, a: 0, b: 0 },
      { set: 2, a: 0, b: 0 },
      { set: 3, a: 0, b: 0 },
    ],
  });
});

test("suporta partida longa em sete sets", () => {
  const parsed = parseScoreRaw("Resultado: 4x3 (8-11, 11-6, 11-9, 9-11, 11-8, 7-11, 11-9)");
  assert.deepEqual(parsed, {
    final: { setsA: 4, setsB: 3 },
    sets: [
      { set: 1, a: 8, b: 11 },
      { set: 2, a: 11, b: 6 },
      { set: 3, a: 11, b: 9 },
      { set: 4, a: 9, b: 11 },
      { set: 5, a: 11, b: 8 },
      { set: 6, a: 7, b: 11 },
      { set: 7, a: 11, b: 9 },
    ],
  });
});
