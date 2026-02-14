import assert from "node:assert/strict";
import test from "node:test";
import {
  allocateGroupsCobra,
  computeGroupTable,
  computeRankingPoints,
  computeRatingDelta,
  resolveTies,
  scheduleGroupMatches,
} from "../src/rules/cbtm-rules-engine";
import { loadCbtmRulesConfig, loadCbtmRulesConfigFromRaw } from "../src/rules/cbtm-config-loader";

test("COBRA distribui em snake deterministico", () => {
  const athletes = Array.from({ length: 6 }, (_, idx) => ({
    athleteId: idx + 1,
    name: `A${idx + 1}`,
    seed: idx + 1,
    clubName: `CLUBE ${idx + 1}`,
  }));

  const result = allocateGroupsCobra({
    athletesSorted: athletes,
    groupSizes: [3, 3],
  });

  assert.deepEqual(
    result.groups.map((group) => group.athletes.map((athlete) => athlete.athleteId)),
    [[1, 4, 5], [2, 3, 6]],
  );
});

test("schedule do grupo prioriza confronto de mesmo clube quando existir", () => {
  const matches = scheduleGroupMatches({
    group: {
      groupName: "Grupo 01",
      athletes: [
        { athleteId: 1, name: "A", seed: 1, clubName: "CLUBE X" },
        { athleteId: 2, name: "B", seed: 2, clubName: "CLUBE X" },
        { athleteId: 3, name: "C", seed: 3, clubName: "CLUBE Y" },
      ],
    },
  });

  assert.deepEqual(matches[0], { athleteAId: 1, athleteBId: 2 });
});

test("desempate para 2 atletas usa confronto direto", () => {
  const tie = resolveTies({
    athleteIds: [10, 11],
    matches: [
      { athleteAId: 10, athleteBId: 11, winnerId: 10, setsA: 3, setsB: 2, pointsA: 40, pointsB: 35 },
    ],
    seed: "x",
  });

  assert.deepEqual(tie.orderedAthleteIds, [10, 11]);
});

test("desempate 3 atletas usa razao de sets quando partidas empatam", () => {
  const table = computeGroupTable({
    athleteIds: [1, 2, 3],
    matches: [
      { athleteAId: 1, athleteBId: 2, winnerId: 1, setsA: 3, setsB: 2, pointsA: 45, pointsB: 42 },
      { athleteAId: 2, athleteBId: 3, winnerId: 2, setsA: 3, setsB: 0, pointsA: 33, pointsB: 20 },
      { athleteAId: 3, athleteBId: 1, winnerId: 3, setsA: 3, setsB: 1, pointsA: 36, pointsB: 25 },
    ],
    seed: "sets",
  });

  assert.deepEqual(table.standings.map((item) => item.athleteId), [2, 1, 3]);
});

test("desempate absoluto cai em sorteio deterministico", () => {
  const first = resolveTies({
    athleteIds: [1, 2, 3],
    matches: [
      { athleteAId: 1, athleteBId: 2, winnerId: null, setsA: 0, setsB: 0, pointsA: 0, pointsB: 0 },
      { athleteAId: 2, athleteBId: 3, winnerId: null, setsA: 0, setsB: 0, pointsA: 0, pointsB: 0 },
      { athleteAId: 3, athleteBId: 1, winnerId: null, setsA: 0, setsB: 0, pointsA: 0, pointsB: 0 },
    ],
    seed: "draw-seed",
  });
  const second = resolveTies({
    athleteIds: [1, 2, 3],
    matches: [
      { athleteAId: 1, athleteBId: 2, winnerId: null, setsA: 0, setsB: 0, pointsA: 0, pointsB: 0 },
      { athleteAId: 2, athleteBId: 3, winnerId: null, setsA: 0, setsB: 0, pointsA: 0, pointsB: 0 },
      { athleteAId: 3, athleteBId: 1, winnerId: null, setsA: 0, setsB: 0, pointsA: 0, pointsB: 0 },
    ],
    seed: "draw-seed",
  });

  assert.deepEqual(first.orderedAthleteIds, second.orderedAthleteIds);
  assert.equal(first.tieTechnical, true);
});

test("ranking points usa tabela configuravel", () => {
  assert.equal(computeRankingPoints({ eventType: "ESTADUAL", finalStage: "1" }), 3900);
  assert.equal(computeRankingPoints({ eventType: "ESTADUAL", finalStage: "G" }), 100);
});

test("rating delta aplica bucket e peso do evento", () => {
  const output = computeRatingDelta({
    ratingA: 2000,
    ratingB: 1900,
    winner: "B",
    eventType: "ESTADUAL",
  });

  assert.equal(output.trace.caseA, "expected_loss");
  assert.equal(output.trace.caseB, "unexpected_win");
  assert.equal(output.deltaA, -12);
  assert.equal(output.deltaB, 42);
});

test("loader valida configs CBTM", () => {
  const config = loadCbtmRulesConfig();
  assert.ok(config.ratingBasicDeltaTable.length > 0);
  assert.equal(config.ratingEventWeights.ESTADUAL, 3);
  assert.equal(config.rankingPointsTable.REGIONAL["2"], 800);
});

test("loader falha com erro orientativo quando tabela básica de rating está ausente", () => {
  assert.throws(
    () =>
      loadCbtmRulesConfigFromRaw({
        rankingPointsTable: loadCbtmRulesConfig().rankingPointsTable,
        ratingEventWeights: loadCbtmRulesConfig().ratingEventWeights,
        ratingBasicDeltaTable: [],
      }),
    /rating_basic_delta_table/i,
  );
});
