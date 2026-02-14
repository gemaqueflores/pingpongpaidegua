import assert from "node:assert/strict";
import test from "node:test";
import { simulateGroupsForCategory } from "../src/user/group-simulator";

function athlete(id: number, club: string, rating: number) {
  return {
    athleteId: id,
    nameDisplay: `ATLETA ${id}`,
    clubId: null,
    clubName: club,
    rankingPoints: rating,
    ratingPoints: rating,
  };
}

test("simulador distribui tamanhos de grupos de forma balanceada", () => {
  const result = simulateGroupsForCategory({
    seed: "event:1:cat:1",
    athletes: [
      athlete(1, "A", 2000),
      athlete(2, "B", 1950),
      athlete(3, "C", 1900),
      athlete(4, "D", 1850),
      athlete(5, "E", 1800),
      athlete(6, "F", 1750),
      athlete(7, "G", 1700),
      athlete(8, "H", 1650),
      athlete(9, "I", 1600),
    ],
    preferredGroupCount: 3,
  });

  const sizes = result.groups.map((group) => group.athletes.length);
  const min = Math.min(...sizes);
  const max = Math.max(...sizes);
  assert.ok(max - min <= 1);
});

test("simulador usa distribuicao em zigue-zague invertido (A-B-C-C-B-A)", () => {
  const result = simulateGroupsForCategory({
    seed: "event:2:cat:3",
    athletes: [
      athlete(1, "CLUBE A", 2000),
      athlete(2, "CLUBE B", 1900),
      athlete(3, "CLUBE C", 1800),
      athlete(4, "CLUBE D", 1700),
      athlete(5, "CLUBE E", 1600),
      athlete(6, "CLUBE F", 1500),
      athlete(7, "CLUBE G", 1400),
      athlete(8, "CLUBE H", 1300),
      athlete(9, "CLUBE I", 1200),
    ],
  });

  assert.equal(result.groups.length, 3);
  assert.deepEqual(
    result.stats.initialDistribution.map((group) => group.athleteIds),
    [
      [1, 6, 7],
      [2, 5, 8],
      [3, 4, 9],
    ],
  );
});

test("simulador aplica swap para reduzir colisoes quando possivel", () => {
  const result = simulateGroupsForCategory({
    seed: "event:swap:cat:1",
    athletes: [
      athlete(1, "CLUBE A", 2000),
      athlete(2, "CLUBE B", 1900),
      athlete(3, "CLUBE C", 1800),
      athlete(4, "CLUBE A", 1700),
      athlete(5, "CLUBE B", 1600),
      athlete(6, "CLUBE D", 1500),
      athlete(7, "CLUBE A", 1400),
      athlete(8, "CLUBE B", 1300),
      athlete(9, "CLUBE E", 1200),
    ],
  });

  assert.ok(result.stats.collisionsBefore > result.stats.collisionsAfter);
  assert.ok(result.stats.swapsApplied > 0);
});

test("simulador mantem colisoes quando cenario e insolavel e gera warning", () => {
  const result = simulateGroupsForCategory({
    seed: "event:3:cat:5",
    athletes: [
      athlete(1, "CLUBE X", 2000),
      athlete(2, "CLUBE X", 1950),
      athlete(3, "CLUBE X", 1900),
      athlete(4, "CLUBE X", 1850),
      athlete(5, "CLUBE X", 1800),
      athlete(6, "CLUBE X", 1750),
      athlete(7, "CLUBE X", 1700),
      athlete(8, "CLUBE X", 1650),
      athlete(9, "CLUBE X", 1600),
    ],
  });

  assert.ok(result.stats.collisionsAfter > 0);
  assert.ok(result.stats.collisionsBefore === result.stats.collisionsAfter);
  assert.ok(result.warnings.length > 0);
});

test("simulador e deterministico para mesma entrada", () => {
  const athletes = [
    athlete(1, "A", 2000),
    athlete(2, "B", 1900),
    athlete(3, "C", 1800),
    athlete(4, "D", 1700),
    athlete(5, "E", 1600),
    athlete(6, "F", 1500),
  ];

  const first = simulateGroupsForCategory({
    seed: "fixed-seed",
    athletes,
    preferredGroupCount: 2,
  });
  const second = simulateGroupsForCategory({
    seed: "fixed-seed",
    athletes,
    preferredGroupCount: 2,
  });

  assert.deepEqual(first.groups, second.groups);
  assert.deepEqual(first.stats, second.stats);
});

test("simulador preserva estritamente o conjunto de atletas da categoria", () => {
  const input = [
    athlete(1, "A", 2200),
    athlete(2, "A", 2100),
    athlete(3, "B", 2000),
    athlete(4, "B", 1900),
    athlete(5, "C", 1800),
    athlete(6, "C", 1700),
    athlete(7, "D", 1600),
    athlete(8, "D", 1500),
    athlete(9, "E", 1400),
  ];

  const result = simulateGroupsForCategory({
    seed: "event:closed-set:cat:9",
    athletes: input,
  });

  const inputIds = [...new Set(input.map((item) => item.athleteId))].sort((a, b) => a - b);
  const outputIds = result.groups
    .flatMap((group) => group.athletes.map((item) => item.athleteId))
    .sort((a, b) => a - b);

  assert.deepEqual(outputIds, inputIds);
});

test("simulador descarta duplicidade de athleteId na entrada", () => {
  const result = simulateGroupsForCategory({
    seed: "event:dedupe:cat:9",
    athletes: [
      athlete(1, "A", 2000),
      athlete(1, "A", 2000),
      athlete(2, "B", 1900),
      athlete(3, "C", 1800),
    ],
    preferredGroupCount: 1,
  });

  const outputIds = result.groups.flatMap((group) => group.athletes.map((item) => item.athleteId));
  assert.equal(outputIds.filter((id) => id === 1).length, 1);
  assert.ok(result.warnings.some((warning) => warning.includes("duplicado(s)")));
});

test("categoria com um unico grupo usa rotulo Unico", () => {
  const result = simulateGroupsForCategory({
    seed: "event:4:cat:1",
    athletes: [athlete(1, "A", 2000), athlete(2, "B", 1800), athlete(3, "C", 1600)],
    preferredGroupCount: 1,
  });

  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].groupName, "Único");
});

test("regra de quantidade de grupos por faixa de atletas", () => {
  const ateCinco = simulateGroupsForCategory({
    seed: "rule:5",
    athletes: [
      athlete(1, "A", 100),
      athlete(2, "B", 90),
      athlete(3, "C", 80),
      athlete(4, "D", 70),
      athlete(5, "E", 60),
    ],
  });
  assert.equal(ateCinco.groups.length, 1);
  assert.equal(ateCinco.groups[0].groupName, "Único");

  const seisAtletas = simulateGroupsForCategory({
    seed: "rule:6",
    athletes: [
      athlete(1, "A", 100),
      athlete(2, "B", 99),
      athlete(3, "C", 98),
      athlete(4, "D", 97),
      athlete(5, "E", 96),
      athlete(6, "F", 95),
    ],
  });
  assert.equal(seisAtletas.groups.length, 2);
  assert.deepEqual(
    seisAtletas.groups.map((group) => group.athletes.length).sort((a, b) => a - b),
    [3, 3],
  );

  const seteAtletas = simulateGroupsForCategory({
    seed: "rule:7",
    athletes: [
      athlete(1, "A", 100),
      athlete(2, "B", 99),
      athlete(3, "C", 98),
      athlete(4, "D", 97),
      athlete(5, "E", 96),
      athlete(6, "F", 95),
      athlete(7, "G", 94),
    ],
  });
  assert.equal(seteAtletas.groups.length, 2);
  assert.deepEqual(
    seteAtletas.groups.map((group) => group.athletes.length).sort((a, b) => a - b),
    [3, 4],
  );

  const oitoAtletas = simulateGroupsForCategory({
    seed: "rule:8",
    athletes: [
      athlete(1, "A", 100),
      athlete(2, "B", 99),
      athlete(3, "C", 98),
      athlete(4, "D", 97),
      athlete(5, "E", 96),
      athlete(6, "F", 95),
      athlete(7, "G", 94),
      athlete(8, "H", 93),
    ],
  });
  assert.equal(oitoAtletas.groups.length, 2);
  assert.ok(oitoAtletas.groups.every((group) => group.athletes.length === 4));

  const dozeAtletas = simulateGroupsForCategory({
    seed: "rule:12",
    athletes: [
      athlete(1, "A", 100),
      athlete(2, "B", 99),
      athlete(3, "C", 98),
      athlete(4, "D", 97),
      athlete(5, "E", 96),
      athlete(6, "F", 95),
      athlete(7, "G", 94),
      athlete(8, "H", 93),
      athlete(9, "I", 92),
      athlete(10, "J", 91),
      athlete(11, "K", 90),
      athlete(12, "L", 89),
    ],
  });
  assert.equal(dozeAtletas.groups.length, 4);
  assert.ok(dozeAtletas.groups.every((group) => group.athletes.length === 3));

  const onzeAtletas = simulateGroupsForCategory({
    seed: "rule:11",
    athletes: [
      athlete(1, "A", 100),
      athlete(2, "B", 99),
      athlete(3, "C", 98),
      athlete(4, "D", 97),
      athlete(5, "E", 96),
      athlete(6, "F", 95),
      athlete(7, "G", 94),
      athlete(8, "H", 93),
      athlete(9, "I", 92),
      athlete(10, "J", 91),
      athlete(11, "K", 90),
    ],
  });
  assert.equal(onzeAtletas.groups.length, 3);
  const tamanhosOnze = onzeAtletas.groups.map((group) => group.athletes.length);
  assert.equal(tamanhosOnze.filter((size) => size === 4).length, 2);
  assert.equal(tamanhosOnze.filter((size) => size === 3).length, 1);

  const dezAtletas = simulateGroupsForCategory({
    seed: "rule:10",
    athletes: [
      athlete(1, "A", 100),
      athlete(2, "B", 99),
      athlete(3, "C", 98),
      athlete(4, "D", 97),
      athlete(5, "E", 96),
      athlete(6, "F", 95),
      athlete(7, "G", 94),
      athlete(8, "H", 93),
      athlete(9, "I", 92),
      athlete(10, "J", 91),
    ],
  });
  assert.equal(dezAtletas.groups.length, 3);
  const tamanhosDez = dezAtletas.groups.map((group) => group.athletes.length);
  assert.equal(tamanhosDez.filter((size) => size === 4).length, 1);
  assert.equal(tamanhosDez.filter((size) => size === 3).length, 2);
});

test("preferencia historica invalida e ignorada para respeitar a regra", () => {
  const result = simulateGroupsForCategory({
    seed: "rule:preferred-invalid",
    athletes: [
      athlete(1, "A", 100),
      athlete(2, "B", 99),
      athlete(3, "C", 98),
      athlete(4, "D", 97),
      athlete(5, "E", 96),
      athlete(6, "F", 95),
      athlete(7, "G", 94),
      athlete(8, "H", 93),
      athlete(9, "I", 92),
      athlete(10, "J", 91),
    ],
    preferredGroupCount: 2,
  });

  assert.equal(result.groups.length, 3);
  assert.ok(result.warnings.some((warning) => warning.includes("Preferencia historica")));
});
