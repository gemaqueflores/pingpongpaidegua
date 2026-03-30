import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCategoryMedalists } from "../src/user/podium-normalizer";

test("normaliza podio com no maximo 1 ouro, 1 prata e 2 bronzes", () => {
  const normalized = normalizeCategoryMedalists([
    { athleteId: 1, athleteName: "A", medalha: "ouro" as const, position: 1 },
    { athleteId: 2, athleteName: "B", medalha: "ouro" as const, position: 1 },
    { athleteId: 3, athleteName: "C", medalha: "prata" as const, position: 2 },
    { athleteId: 4, athleteName: "D", medalha: "prata" as const, position: 2 },
    { athleteId: 5, athleteName: "E", medalha: "bronze" as const, position: 3 },
    { athleteId: 6, athleteName: "F", medalha: "bronze" as const, position: 3 },
    { athleteId: 7, athleteName: "G", medalha: "bronze" as const, position: 3 },
  ]);

  assert.equal(normalized.filter((item) => item.medalha === "ouro").length, 1);
  assert.equal(normalized.filter((item) => item.medalha === "prata").length, 1);
  assert.equal(normalized.filter((item) => item.medalha === "bronze").length, 2);
});

test("prioriza menor posicao e nome para desempate deterministico", () => {
  const normalized = normalizeCategoryMedalists([
    { athleteId: 10, athleteName: "Bruno", medalha: "ouro" as const, position: 1 },
    { athleteId: 9, athleteName: "Ana", medalha: "ouro" as const, position: 1 },
  ]);

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].athleteName, "Ana");
});

test("mantem podio valido sem alterar quantidade", () => {
  const normalized = normalizeCategoryMedalists([
    { athleteId: 1, athleteName: "A", medalha: "ouro" as const, position: 1 },
    { athleteId: 2, athleteName: "B", medalha: "prata" as const, position: 2 },
    { athleteId: 3, athleteName: "C", medalha: "bronze" as const, position: 3 },
    { athleteId: 4, athleteName: "D", medalha: "bronze" as const, position: 4 },
  ]);

  assert.equal(normalized.length, 4);
  assert.deepEqual(
    normalized.map((item) => item.medalha),
    ["ouro", "prata", "bronze", "bronze"],
  );
});

test("deduplica medalhistas pela unidade competitiva quando informado", () => {
  const normalized = normalizeCategoryMedalists([
    { athleteId: 1, athleteName: "A # B", medalha: "ouro" as const, position: 1, unitKey: "pair:a#b" },
    { athleteId: 2, athleteName: "A # B", medalha: "ouro" as const, position: 1, unitKey: "pair:a#b" },
    { athleteId: 3, athleteName: "C # D", medalha: "prata" as const, position: 2, unitKey: "pair:c#d" },
    { athleteId: 4, athleteName: "E # F", medalha: "bronze" as const, position: 3, unitKey: "pair:e#f" },
    { athleteId: 5, athleteName: "G # H", medalha: "bronze" as const, position: 4, unitKey: "pair:g#h" },
  ]);

  assert.equal(normalized.length, 4);
  assert.deepEqual(
    normalized.map((item) => item.unitKey),
    ["pair:a#b", "pair:c#d", "pair:e#f", "pair:g#h"],
  );
});

test("deduplica alias de dupla com nomes equivalentes no mesmo podio", () => {
  const normalized = normalizeCategoryMedalists([
    { athleteId: 1, athleteName: "LILIAN # SOFIA MENDONÃ‡A", medalha: "bronze" as const, position: 3 },
    { athleteId: 2, athleteName: "LILIAN DUARTE - SOFIA MENDONÃ‡A", medalha: "bronze" as const, position: 3 },
  ]);

  assert.equal(normalized.length, 1);
});

test("deduplica dupla por unitKey equivalente quando o alias acrescenta sobrenome", () => {
  const normalized = normalizeCategoryMedalists([
    {
      athleteId: 1,
      athleteName: "LILIAN # SOFIA MENDONÇA",
      medalha: "bronze" as const,
      position: 3,
      unitKey: "pair:lilian sofia mendonca",
    },
    {
      athleteId: 2,
      athleteName: "LILIAN DUARTE - SOFIA MENDONÇA",
      medalha: "bronze" as const,
      position: 3,
      unitKey: "pair:lilian duarte sofia mendonca",
    },
  ]);

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].unitKey, "pair:lilian sofia mendonca");
});
