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

function athleteWithPoints(input: {
  id: number;
  club: string;
  rankingPoints: number | null;
  ratingPoints: number | null;
  name?: string;
}) {
  return {
    athleteId: input.id,
    nameDisplay: input.name ?? `ATLETA ${input.id}`,
    clubId: null,
    clubName: input.club,
    rankingPoints: input.rankingPoints,
    ratingPoints: input.ratingPoints,
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

test("categorias rating com formato K1 simulam confrontos iniciais sem grupos", () => {
  const athletes = Array.from({ length: 16 }, (_, index) =>
    athlete(index + 1, `CLUBE ${index + 1}`, 2000 - index * 10),
  );

  const result = simulateGroupsForCategory({
    seed: "event:k1:cat:rating",
    categoryName: "RJM",
    ratingMatchFormat: "K1",
    athletes,
  });

  assert.equal(result.stats.structureType, "knockout");
  assert.equal(result.groups.length, 0);
  assert.equal(result.matchups.length, 8);
  assert.equal(result.stats.seededAthleteCount, 4);

  const seedBlocks = new Map<number, string>();
  for (const matchup of result.matchups) {
    if (matchup.athleteASeed) {
      seedBlocks.set(matchup.athleteASeed, matchup.blockName);
    }
    if (matchup.athleteBSeed) {
      seedBlocks.set(matchup.athleteBSeed, matchup.blockName);
    }
  }

  assert.equal(seedBlocks.size, 4);
  assert.equal(new Set(seedBlocks.values()).size, 4);
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

test("com 10 atletas em 3 grupos a sobra fica no ultimo grupo e mantem COBRA no final", () => {
  const result = simulateGroupsForCategory({
    seed: "event:10:cat:cobra-tail",
    athletes: [
      athlete(1, "A", 1000),
      athlete(2, "B", 990),
      athlete(3, "C", 980),
      athlete(4, "D", 970),
      athlete(5, "E", 960),
      athlete(6, "F", 950),
      athlete(7, "G", 940),
      athlete(8, "H", 930),
      athlete(9, "I", 920),
      athlete(10, "J", 910),
    ],
  });

  assert.deepEqual(
    result.stats.initialDistribution.map((group) => group.athleteIds),
    [
      [1, 6, 7],
      [2, 5, 8],
      [3, 4, 9, 10],
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
  assert.equal(result.groups[0].athletes[0]?.athleteId, 1);
  assert.equal(result.groups[1].athletes[0]?.athleteId, 2);
  assert.equal(result.groups[2].athletes[0]?.athleteId, 3);
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

test("categoria iniciando com R ordena por ratingPoints", () => {
  const result = simulateGroupsForCategory({
    seed: "sort:basis:rating",
    categoryName: "RIF",
    athletes: [
      athleteWithPoints({ id: 1, club: "A", rankingPoints: 2000, ratingPoints: 1200 }),
      athleteWithPoints({ id: 2, club: "B", rankingPoints: 1000, ratingPoints: 1800 }),
      athleteWithPoints({ id: 3, club: "C", rankingPoints: 1500, ratingPoints: 1600 }),
    ],
    preferredGroupCount: 1,
  });

  assert.equal(result.stats.sortBasis, "rating");
  assert.equal(result.stats.primaryFieldUsed, "ratingPoints");
  assert.deepEqual(result.stats.initialDistribution[0].athleteIds, [2, 3, 1]);
});

test("categoria nao R ordena por rankingPoints", () => {
  const result = simulateGroupsForCategory({
    seed: "sort:basis:ranking",
    categoryName: "SUB-11 FEM",
    athletes: [
      athleteWithPoints({ id: 1, club: "A", rankingPoints: 1200, ratingPoints: 2000 }),
      athleteWithPoints({ id: 2, club: "B", rankingPoints: 1800, ratingPoints: 1000 }),
      athleteWithPoints({ id: 3, club: "C", rankingPoints: 1600, ratingPoints: 1500 }),
    ],
    preferredGroupCount: 1,
  });

  assert.equal(result.stats.sortBasis, "ranking");
  assert.equal(result.stats.primaryFieldUsed, "rankingPoints");
  assert.deepEqual(result.stats.initialDistribution[0].athleteIds, [2, 3, 1]);
});

test("ordenacao aplica fallback para campo alternativo quando principal ausente", () => {
  const result = simulateGroupsForCategory({
    seed: "sort:fallback",
    categoryName: "RATING OPEN",
    athletes: [
      athleteWithPoints({ id: 1, club: "A", rankingPoints: 1000, ratingPoints: null }),
      athleteWithPoints({ id: 2, club: "B", rankingPoints: 900, ratingPoints: 1100 }),
      athleteWithPoints({ id: 3, club: "C", rankingPoints: 800, ratingPoints: null }),
    ],
    preferredGroupCount: 1,
  });

  assert.equal(result.stats.sortBasis, "rating");
  assert.equal(result.stats.primaryFieldUsed, "ratingPoints");
  assert.equal(result.stats.fallbackUsedCount, 2);
  assert.deepEqual(result.stats.initialDistribution[0].athleteIds, [2, 1, 3]);
});

test("categoria de ranking desempata por rating quando ranking empata", () => {
  const result = simulateGroupsForCategory({
    seed: "sort:tie:ranking-uses-rating",
    categoryName: "SUB-15 MASC",
    athletes: [
      athleteWithPoints({ id: 1, club: "A", rankingPoints: 1200, ratingPoints: 900 }),
      athleteWithPoints({ id: 2, club: "B", rankingPoints: 1200, ratingPoints: 1100 }),
      athleteWithPoints({ id: 3, club: "C", rankingPoints: 1000, ratingPoints: 2000 }),
    ],
    preferredGroupCount: 1,
  });

  assert.equal(result.stats.sortBasis, "ranking");
  assert.deepEqual(result.stats.initialDistribution[0].athleteIds, [2, 1, 3]);
});

test("categoria de rating desempata por ranking quando rating empata", () => {
  const result = simulateGroupsForCategory({
    seed: "sort:tie:rating-uses-ranking",
    categoryName: "RGM",
    athletes: [
      athleteWithPoints({ id: 1, club: "A", rankingPoints: 1400, ratingPoints: 1000 }),
      athleteWithPoints({ id: 2, club: "B", rankingPoints: 1300, ratingPoints: 1000 }),
      athleteWithPoints({ id: 3, club: "C", rankingPoints: 2000, ratingPoints: 900 }),
    ],
    preferredGroupCount: 1,
  });

  assert.equal(result.stats.sortBasis, "rating");
  assert.deepEqual(result.stats.initialDistribution[0].athleteIds, [1, 2, 3]);
});

test("atletas dentro do grupo ficam ordenados por pontos de forma decrescente", () => {
  const result = simulateGroupsForCategory({
    seed: "sort:inside-group",
    categoryName: "SUB-13 FEM",
    athletes: [
      athleteWithPoints({ id: 1, club: "A", rankingPoints: 1760, ratingPoints: 1000 }),
      athleteWithPoints({ id: 2, club: "B", rankingPoints: 300, ratingPoints: 2000 }),
      athleteWithPoints({ id: 3, club: "C", rankingPoints: 1520, ratingPoints: 1100 }),
      athleteWithPoints({ id: 4, club: "D", rankingPoints: 700, ratingPoints: 900 }),
    ],
    preferredGroupCount: 1,
  });

  const points = result.groups[0].athletes.map((athleteItem) => athleteItem.rankingPoints ?? 0);
  const sorted = [...points].sort((a, b) => b - a);
  assert.deepEqual(points, sorted);
});

test("quando colisao e inevitavel, mantem distribuicao cobra da categoria", () => {
  const result = simulateGroupsForCategory({
    seed: "sub13fem:inevitavel",
    categoryName: "SUB-13 FEM",
    athletes: [
      athleteWithPoints({ id: 1, name: "YUKARI SATO", club: "BEL", rankingPoints: 1360, ratingPoints: 662 }),
      athleteWithPoints({ id: 2, name: "KAYLANNE DEUS", club: "PARA", rankingPoints: 1250, ratingPoints: 350 }),
      athleteWithPoints({ id: 3, name: "ISABELA OLIVEIRA", club: "APTM", rankingPoints: 1240, ratingPoints: 398 }),
      athleteWithPoints({ id: 4, name: "MARIANNY MORAES", club: "PARA", rankingPoints: 990, ratingPoints: 611 }),
      athleteWithPoints({ id: 5, name: "ESTER MORAES", club: "YOSHIDA", rankingPoints: 300, ratingPoints: 439 }),
      athleteWithPoints({ id: 6, name: "ANA SOUZA", club: "PARA", rankingPoints: 100, ratingPoints: 27 }),
      athleteWithPoints({ id: 7, name: "ANNA RODRIGUES", club: "BEL", rankingPoints: 0, ratingPoints: 573 }),
    ],
  });

  // Snake A-B-B-A-A-B-B sobre ranking decrescente para 7 atletas (4x3).
  assert.deepEqual(result.stats.initialDistribution.map((group) => group.athleteIds), [
    [1, 4, 5],
    [2, 3, 6, 7],
  ]);

  assert.equal(result.stats.collisionsBefore, result.stats.collisionsAfter);
  assert.equal(result.stats.swapsApplied, 0);
});

test("RGM remaneja TOMAZ e ADRIAN sem trocar cabecas de chave", () => {
  const result = simulateGroupsForCategory({
    seed: "rgm:swap:tomaz-adrian",
    categoryName: "RGM",
    athletes: [
      athleteWithPoints({ id: 1, name: "DOMINI", club: "APTM", rankingPoints: 0, ratingPoints: 1297 }),
      athleteWithPoints({ id: 2, name: "JUCIVAL", club: "BEL", rankingPoints: 0, ratingPoints: 1190 }),
      athleteWithPoints({ id: 3, name: "FABRIZIO", club: "PARA", rankingPoints: 0, ratingPoints: 1187 }),
      athleteWithPoints({ id: 4, name: "MATHEUS", club: "PAYSANDU", rankingPoints: 0, ratingPoints: 1160 }),
      athleteWithPoints({ id: 5, name: "PEDRO", club: "PARA CLUBE", rankingPoints: 0, ratingPoints: 1145 }),
      athleteWithPoints({ id: 6, name: "PABLO", club: "ASSEMBLEIA", rankingPoints: 0, ratingPoints: 1120 }),
      athleteWithPoints({ id: 7, name: "TOMAZ", club: "APTM", rankingPoints: 0, ratingPoints: 1104 }),
      athleteWithPoints({ id: 8, name: "ADRIAN", club: "BEL", rankingPoints: 0, ratingPoints: 1048 }),
      athleteWithPoints({ id: 9, name: "BRUNO", club: "PARA", rankingPoints: 0, ratingPoints: 1036 }),
      athleteWithPoints({ id: 10, name: "ADRIANO", club: "YOSHIDA", rankingPoints: 0, ratingPoints: 1030 }),
    ],
  });

  assert.deepEqual(result.stats.initialDistribution.map((group) => group.athleteIds), [
    [1, 6, 7],
    [2, 5, 8],
    [3, 4, 9, 10],
  ]);
  assert.equal(result.groups[0].athletes[0].athleteId, 1);
  assert.equal(result.groups[1].athletes[0].athleteId, 2);
  assert.equal(result.groups[2].athletes[0].athleteId, 3);
  assert.ok(result.groups[0].athletes.some((athleteItem) => athleteItem.athleteId === 8));
  assert.ok(result.groups[1].athletes.some((athleteItem) => athleteItem.athleteId === 7));
  assert.ok(result.stats.collisionsAfter < result.stats.collisionsBefore);
  assert.equal(result.stats.swapsApplied, 1);
});
