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

