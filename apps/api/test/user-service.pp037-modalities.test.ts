import assert from "node:assert/strict";
import test from "node:test";
import { rankingFor, careerFor } from "./fixtures/pp037-modalities";

test("PP-037 T-U-01 ranking soma somente o ouro individual", async () => {
  const result = await rankingFor(["RATING A", "DUPLAS MASCULINAS"]);
  assert.equal(result.ranking[0].ouro, 1);
  assert.equal(result.ranking[0].totalQuantidade, 1);
  assert.equal(result.ranking[0].totalPontuacao, 390); // 1 ouro x 130 x estadual 3.
  assert.deepEqual(Object.keys(result).sort(), ["ranking", "weights"]);
  const separated = await rankingFor(["RATING A", "DUPLAS MASCULINAS"], true);
  assert.equal(separated.doubles[0].ouro, 1);
  assert.equal(separated.doubles[0].totalPontuacao, 390);
});

test("PP-037 T-U-02 carreira soma somente a prata individual", async () => {
  const result = await careerFor();
  assert.equal(result.medalTable.ESTADUAL.prata, 1);
  assert.equal(result.events[0].performanceByCategory.length, 1);
  assert.equal(result.totals.matches, 1);
  assert.equal(result.totals.performance.pointsWon, 32);
  assert.equal(result.totals.performance.pointsPlayed, 74);
  const separated = await careerFor("ABSOLUTO B", "ETAPA TESTE", true, true);
  assert.equal(separated.doubles.medalTable.ESTADUAL.prata, 1);
  assert.equal(separated.doubles.totals.matches, 1);
  assert.equal(separated.doubles.totals.performance.pointsWon, 32);
  assert.equal("doubles" in result, false);
});

test("PP-037 T-U-03 duplas mistas por categoria, evento ou nome nao contaminam o ranking", async () => {
  const named = await rankingFor(["RATING A", "DUPLA MISTA SUB-13"]);
  assert.equal(named.ranking[0].ouro, 1);
  const eventOnly = await rankingFor(["ABSOLUTO A"], true, { eventName: "ETAPA DUPLAS MISTAS" });
  assert.equal(eventOnly.individual[0].ouro, 0);
  assert.equal(eventOnly.doubles[0].ouro, 1);
  const pairOnly = await rankingFor(["ABSOLUTO A"], true, { athleteNames: ["ALICE # BRUNO"] });
  assert.equal(pairOnly.individual[0].ouro, 0);
  assert.equal(pairOnly.doubles[0].ouro, 1);
});

test("PP-037 T-U-03 carreira preserva prata mista somente na estrutura interna", async () => {
  const result = await careerFor("DUPLA MISTA SUB-13", "ETAPA TESTE", true, true);
  assert.equal(result.individual.medalTable.ESTADUAL.prata, 1);
  assert.equal(result.doubles.medalTable.ESTADUAL.prata, 1);
});

// GREEN de caracterizacao autorizado por Leo: comportamento ja correto na base.
test("PP-037 T-U-04 individuais preservam medalhas, pesos e pontos", async () => {
  const ranking = await rankingFor(["RATING A", "ABSOLUTO B"], true);
  assert.equal(ranking.individual[0].ouro, 2);
  assert.equal(ranking.individual[0].totalPontuacao, 780);
  assert.equal(ranking.doubles[0].totalQuantidade, 0);
  const career = await careerFor("ABSOLUTO B", "ETAPA TESTE", false, true);
  assert.equal(career.individual.medalTable.ESTADUAL.prata, 1);
  assert.equal(career.individual.totals.matches, 1);
  assert.equal(career.individual.totals.performance.pointsWon, 32);
  assert.equal(career.individual.totals.performance.pointsPlayed, 74);
  assert.equal(career.doubles.medalTable.ESTADUAL.prata, 0);
  assert.equal(career.doubles.totals.matches, 0);
});
