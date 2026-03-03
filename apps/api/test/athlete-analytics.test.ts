import assert from "node:assert/strict";
import test from "node:test";
import {
  collectWalkoverLoserAthleteIds,
  computeCategoryClassificationSummaries,
  computeCategoryPerformanceSummaries,
  isWalkoverMatch,
  type CategoryAnalyticsMatch,
} from "../src/user/athlete-analytics";

function createMatch(input: Partial<CategoryAnalyticsMatch>): CategoryAnalyticsMatch {
  return {
    categoryId: 1,
    categoryName: "SUB-21 MAS",
    phase: "ELIMINATORIA",
    round: "Quartas de Final",
    players: [
      { athleteId: 10, name: "ATLETA A" },
      { athleteId: 11, name: "ATLETA B" },
    ],
    sets: [],
    setsResult: { p1Sets: 3, p2Sets: 0 },
    winnerIndex: 0,
    ...input,
  };
}

test("detecta WO quando placar e parciais sao 3x0 com 11x0", () => {
  const match = createMatch({
    players: [{ athleteId: 100, name: "Vencedor" }, { athleteId: 200, name: "Perdedor" }],
    winnerIndex: 0,
    setsResult: { p1Sets: 3, p2Sets: 0 },
    sets: [
      { p1: 11, p2: 0 },
      { p1: 11, p2: 0 },
      { p1: 11, p2: 0 },
    ],
  });

  assert.equal(isWalkoverMatch(match), true);
  assert.deepEqual([...collectWalkoverLoserAthleteIds([match])], [200]);
});

test("nao detecta WO quando houver parcial diferente de 11x0", () => {
  const match = createMatch({
    players: [{ athleteId: 100, name: "Vencedor" }, { athleteId: 200, name: "Perdedor" }],
    winnerIndex: 0,
    setsResult: { p1Sets: 3, p2Sets: 0 },
    sets: [
      { p1: 11, p2: 0 },
      { p1: 11, p2: 8 },
      { p1: 11, p2: 0 },
    ],
  });

  assert.equal(isWalkoverMatch(match), false);
  assert.equal(collectWalkoverLoserAthleteIds([match]).size, 0);
});

test("detecta duplo WO com placar 0-0 e parciais 0-0", () => {
  const match = createMatch({
    players: [{ athleteId: 300, name: "Ausente A" }, { athleteId: 400, name: "Ausente B" }],
    winnerIndex: null,
    setsResult: { p1Sets: 0, p2Sets: 0 },
    sets: [
      { p1: 0, p2: 0 },
      { p1: 0, p2: 0 },
      { p1: 0, p2: 0 },
    ],
  });

  assert.equal(isWalkoverMatch(match), true);
  assert.deepEqual([...collectWalkoverLoserAthleteIds([match])].sort((a, b) => a - b), [300, 400]);
});

test("detecta duplo WO quando scoreRaw explicita 0x0 mesmo sem setsResult", () => {
  const match = createMatch({
    players: [{ athleteId: 300, name: "Ausente A" }, { athleteId: 400, name: "Ausente B" }],
    winnerIndex: null,
    setsResult: null,
    scoreRaw: "0x0 (0/0,0/0,0/0)",
    sets: [
      { p1: 0, p2: 0 },
      { p1: 0, p2: 0 },
      { p1: 0, p2: 0 },
    ],
  });

  assert.equal(isWalkoverMatch(match), true);
  assert.deepEqual([...collectWalkoverLoserAthleteIds([match])].sort((a, b) => a - b), [300, 400]);
});

test("performance por categoria soma pontos apenas da categoria", () => {
  const matches: CategoryAnalyticsMatch[] = [
    createMatch({
      categoryId: 1,
      categoryName: "SUB-21 MAS",
      sets: [
        { p1: 11, p2: 7 },
        { p1: 9, p2: 11 },
      ],
      setsResult: null,
    }),
    createMatch({
      categoryId: 2,
      categoryName: "ADULTO MAS",
      sets: [{ p1: 11, p2: 6 }],
      setsResult: null,
    }),
  ];

  const perf = computeCategoryPerformanceSummaries(matches, { athleteId: 10 });
  const sub21 = perf.find((item) => item.categoryId === 1);
  assert.ok(sub21);
  assert.equal(sub21.performance.pointsWon, 20);
  assert.equal(sub21.performance.pointsPlayed, 38);
});

test("classificacao eliminatoria campeao", () => {
  const matches: CategoryAnalyticsMatch[] = [
    createMatch({
      round: "Semifinal",
      players: [{ athleteId: 10, name: "A" }, { athleteId: 12, name: "C" }],
      winnerIndex: 0,
    }),
    createMatch({
      round: "Final",
      players: [{ athleteId: 10, name: "A" }, { athleteId: 13, name: "D" }],
      winnerIndex: 0,
    }),
  ];

  const classification = computeCategoryClassificationSummaries(matches, { athleteId: 10 })[0];
  assert.equal(classification.position, 1);
  assert.equal(classification.mode, "eliminatoria");
});

test("eliminatoria com confronto pendente nao bloqueia podio quando final ja foi decidida", () => {
  const matches: CategoryAnalyticsMatch[] = [
    createMatch({
      round: "Final",
      players: [{ athleteId: 10, name: "A" }, { athleteId: 13, name: "D" }],
      winnerIndex: 0,
    }),
    createMatch({
      round: "Semifinal",
      players: [{ athleteId: 12, name: "C" }, { athleteId: 14, name: "E" }],
      winnerIndex: null,
      setsResult: null,
      sets: [],
    }),
  ];

  const classification = computeCategoryClassificationSummaries(matches, { athleteId: 10 })[0];
  assert.equal(classification.position, 1);
  assert.equal(classification.mode, "eliminatoria");
});

test("classificacao eliminatoria mapeia 2 3 5 9 17 33", () => {
  const scenarios: Array<{ round: string; expected: number }> = [
    { round: "Final", expected: 2 },
    { round: "Semifinal", expected: 3 },
    { round: "Quartas de Final", expected: 5 },
    { round: "Oitavas de Final", expected: 9 },
    { round: "Fase 16", expected: 17 },
    { round: "Fase 32", expected: 33 },
  ];

  for (const scenario of scenarios) {
    const classification = computeCategoryClassificationSummaries(
      [
        createMatch({
          round: scenario.round,
          winnerIndex: 1,
        }),
      ],
      { athleteId: 10 },
    )[0];
    assert.equal(classification.position, scenario.expected);
  }
});

test("classificacao de categoria com ate 5 atletas usa grupo unico", () => {
  const matches: CategoryAnalyticsMatch[] = [
    createMatch({
      phase: "GRUPOS",
      round: "Grupo 01",
      players: [{ athleteId: 10, name: "A" }, { athleteId: 11, name: "B" }],
      winnerIndex: 1,
      setsResult: { p1Sets: 0, p2Sets: 3 },
    }),
    createMatch({
      phase: "GRUPOS",
      round: "Grupo 02",
      players: [{ athleteId: 10, name: "A" }, { athleteId: 12, name: "C" }],
      winnerIndex: 1,
      setsResult: { p1Sets: 0, p2Sets: 3 },
    }),
  ];

  const classification = computeCategoryClassificationSummaries(matches, { athleteId: 10 })[0];
  assert.equal(classification.mode, "grupo_unico");
  assert.equal(classification.position, 3);
});

test("WO na fase de grupos anula confrontos anteriores do atleta para desempate/classificacao", () => {
  const matches: CategoryAnalyticsMatch[] = [
    createMatch({
      phase: "GRUPOS",
      round: "Grupo 01",
      players: [{ athleteId: 10, name: "A" }, { athleteId: 11, name: "B" }],
      winnerIndex: 0,
      setsResult: { p1Sets: 3, p2Sets: 0 },
      sets: [
        { p1: 11, p2: 7 },
        { p1: 11, p2: 8 },
        { p1: 11, p2: 9 },
      ],
    }),
    createMatch({
      phase: "GRUPOS",
      round: "Grupo 01",
      players: [{ athleteId: 12, name: "C" }, { athleteId: 11, name: "B" }],
      winnerIndex: 0,
      setsResult: { p1Sets: 3, p2Sets: 0 },
      sets: [
        { p1: 11, p2: 5 },
        { p1: 11, p2: 6 },
        { p1: 11, p2: 7 },
      ],
    }),
    createMatch({
      phase: "GRUPOS",
      round: "Grupo 01",
      players: [{ athleteId: 10, name: "A" }, { athleteId: 12, name: "C" }],
      winnerIndex: 1,
      scoreRaw: "0x3 (0-11, 0-11, 0-11)",
      setsResult: { p1Sets: 0, p2Sets: 3 },
      sets: [
        { p1: 0, p2: 11 },
        { p1: 0, p2: 11 },
        { p1: 0, p2: 11 },
      ],
    }),
  ];

  const classificationB = computeCategoryClassificationSummaries(matches, { athleteId: 11 })[0];
  assert.equal(classificationB.mode, "grupo_unico");
  assert.equal(classificationB.position, 2);
});

test("grupo unico com WO e duplo WO ainda classifica atleta elegivel por comparecimento", () => {
  const matches: CategoryAnalyticsMatch[] = [
    createMatch({
      phase: "RESULTADOS",
      round: "Única 01",
      players: [{ athleteId: 5043, name: "OTAVIO" }, { athleteId: 5041, name: "JOAO" }],
      winnerIndex: 0,
      setsResult: { p1Sets: 3, p2Sets: 0 },
      sets: [
        { p1: 11, p2: 0 },
        { p1: 11, p2: 0 },
        { p1: 11, p2: 0 },
      ],
    }),
    createMatch({
      phase: "RESULTADOS",
      round: "Única 01",
      players: [{ athleteId: 5042, name: "ISAQUE" }, { athleteId: 5041, name: "JOAO" }],
      winnerIndex: null,
      setsResult: { p1Sets: 0, p2Sets: 0 },
      sets: [
        { p1: 0, p2: 0 },
        { p1: 0, p2: 0 },
        { p1: 0, p2: 0 },
      ],
    }),
    createMatch({
      phase: "RESULTADOS",
      round: "Única 01",
      players: [{ athleteId: 5043, name: "OTAVIO" }, { athleteId: 5042, name: "ISAQUE" }],
      winnerIndex: 0,
      setsResult: { p1Sets: 3, p2Sets: 0 },
      sets: [
        { p1: 11, p2: 0 },
        { p1: 11, p2: 0 },
        { p1: 11, p2: 0 },
      ],
    }),
  ];

  const classOtavio = computeCategoryClassificationSummaries(matches, { athleteId: 5043 })[0];
  const classJoao = computeCategoryClassificationSummaries(matches, { athleteId: 5041 })[0];

  assert.equal(classOtavio.mode, "grupo_unico");
  assert.equal(classOtavio.position, 1);
  assert.equal(classJoao.position, null);
});

test("categoria com 5 atletas em unica 01 usa grupo unico e pode gerar 1º lugar", () => {
  const matches: CategoryAnalyticsMatch[] = [
    createMatch({
      phase: "RESULTADOS",
      round: "Única 01",
      players: [{ athleteId: 10, name: "ANNA SOPHIA" }, { athleteId: 11, name: "B" }],
      winnerIndex: 0,
      setsResult: { p1Sets: 3, p2Sets: 0 },
    }),
    createMatch({
      phase: "RESULTADOS",
      round: "Única 01",
      players: [{ athleteId: 10, name: "ANNA SOPHIA" }, { athleteId: 12, name: "C" }],
      winnerIndex: 0,
      setsResult: { p1Sets: 3, p2Sets: 0 },
    }),
    createMatch({
      phase: "RESULTADOS",
      round: "Única 01",
      players: [{ athleteId: 10, name: "ANNA SOPHIA" }, { athleteId: 13, name: "D" }],
      winnerIndex: 0,
      setsResult: { p1Sets: 3, p2Sets: 0 },
    }),
    createMatch({
      phase: "RESULTADOS",
      round: "Única 01",
      players: [{ athleteId: 10, name: "ANNA SOPHIA" }, { athleteId: 14, name: "E" }],
      winnerIndex: 0,
      setsResult: { p1Sets: 3, p2Sets: 0 },
    }),
  ];

  const classification = computeCategoryClassificationSummaries(matches, { athleteId: 10 })[0];
  assert.equal(classification.mode, "grupo_unico");
  assert.equal(classification.position, 1);
});

test("classificacao retorna 33 quando atleta só jogou grupos e houve eliminatoria na categoria", () => {
  const matches: CategoryAnalyticsMatch[] = [
    createMatch({
      phase: "GRUPOS",
      round: "Grupo 01 - Jogo 001",
      players: [{ athleteId: 10, name: "ANNA SOPHIA" }, { athleteId: 11, name: "B" }],
      winnerIndex: 1,
      setsResult: { p1Sets: 1, p2Sets: 3 },
    }),
    createMatch({
      phase: "GRUPOS",
      round: "Grupo 01 - Jogo 002",
      players: [{ athleteId: 10, name: "ANNA SOPHIA" }, { athleteId: 12, name: "C" }],
      winnerIndex: 1,
      setsResult: { p1Sets: 0, p2Sets: 3 },
    }),
    createMatch({
      phase: "ELIMINATORIA",
      round: "Oitavas de Final",
      players: [{ athleteId: 20, name: "X" }, { athleteId: 21, name: "Y" }],
      winnerIndex: 0,
      setsResult: { p1Sets: 3, p2Sets: 1 },
    }),
    createMatch({
      phase: "ELIMINATORIA",
      round: "Oitavas de Final",
      players: [{ athleteId: 22, name: "Z" }, { athleteId: 23, name: "W" }],
      winnerIndex: 0,
      setsResult: { p1Sets: 3, p2Sets: 1 },
    }),
  ];

  const classification = computeCategoryClassificationSummaries(matches, { athleteId: 10 })[0];
  assert.equal(classification.mode, "eliminatoria");
  assert.equal(classification.position, 33);
  assert.equal(classification.reason, "nao_classificado_fase_de_grupos");
});

test("categoria com grupos + eliminatoria deve classificar por eliminatoria mesmo com <=5 participantes efetivos", () => {
  const matches: CategoryAnalyticsMatch[] = [
    createMatch({
      phase: "GRUPOS",
      round: "Grupo 01 - Jogo 001",
      players: [{ athleteId: 10, name: "A" }, { athleteId: 11, name: "B" }],
      winnerIndex: 0,
      setsResult: { p1Sets: 3, p2Sets: 1 },
    }),
    createMatch({
      phase: "GRUPOS",
      round: "Grupo 01 - Jogo 002",
      players: [{ athleteId: 10, name: "A" }, { athleteId: 12, name: "C" }],
      winnerIndex: 1,
      setsResult: { p1Sets: 2, p2Sets: 3 },
    }),
    createMatch({
      phase: "ELIMINATORIA",
      round: "Semifinal",
      players: [{ athleteId: 11, name: "B" }, { athleteId: 12, name: "C" }],
      winnerIndex: 0,
      setsResult: { p1Sets: 3, p2Sets: 2 },
    }),
  ];

  const classification = computeCategoryClassificationSummaries(matches, { athleteId: 10 })[0];
  assert.equal(classification.mode, "eliminatoria");
  assert.equal(classification.position, 33);
  assert.equal(classification.reason, "nao_classificado_fase_de_grupos");
});

test("RHM com semifinal/final define prata como perdedor da final (nao pelo grupo unico)", () => {
  const matches: CategoryAnalyticsMatch[] = [
    createMatch({
      phase: "GRUPOS",
      round: "RHM - Grupo 01",
      players: [{ athleteId: 100, name: "LUCAS SERRAO" }, { athleteId: 101, name: "JOSE SILVA" }],
      winnerIndex: 0,
      setsResult: { p1Sets: 3, p2Sets: 0 },
      sets: [
        { p1: 11, p2: 0 },
        { p1: 11, p2: 0 },
        { p1: 11, p2: 0 },
      ],
    }),
    createMatch({
      phase: "GRUPOS",
      round: "RHM - Grupo 01",
      players: [{ athleteId: 102, name: "ARNALDO SOUTO" }, { athleteId: 101, name: "JOSE SILVA" }],
      winnerIndex: 0,
      setsResult: { p1Sets: 3, p2Sets: 0 },
      sets: [
        { p1: 11, p2: 0 },
        { p1: 11, p2: 0 },
        { p1: 11, p2: 0 },
      ],
    }),
    createMatch({
      phase: "GRUPOS",
      round: "RHM - Grupo 01",
      players: [{ athleteId: 100, name: "LUCAS SERRAO" }, { athleteId: 102, name: "ARNALDO SOUTO" }],
      winnerIndex: 0,
      setsResult: { p1Sets: 3, p2Sets: 1 },
    }),
    createMatch({
      phase: "GRUPOS",
      round: "RHM - Grupo 02",
      players: [{ athleteId: 103, name: "BRUNO GARCIA" }, { athleteId: 104, name: "NALDO SILVA" }],
      winnerIndex: 1,
      setsResult: { p1Sets: 0, p2Sets: 3 },
    }),
    createMatch({
      phase: "ELIMINATORIA",
      round: "RHM - Semi Final",
      players: [{ athleteId: 100, name: "LUCAS SERRAO" }, { athleteId: 103, name: "BRUNO GARCIA" }],
      winnerIndex: 0,
      setsResult: { p1Sets: 3, p2Sets: 2 },
    }),
    createMatch({
      phase: "ELIMINATORIA",
      round: "RHM - Semi Final",
      players: [{ athleteId: 102, name: "ARNALDO SOUTO" }, { athleteId: 104, name: "NALDO SILVA" }],
      winnerIndex: 0,
      setsResult: { p1Sets: 3, p2Sets: 0 },
    }),
    createMatch({
      phase: "ELIMINATORIA",
      round: "RHM - Final",
      players: [{ athleteId: 100, name: "LUCAS SERRAO" }, { athleteId: 102, name: "ARNALDO SOUTO" }],
      winnerIndex: 0,
      setsResult: { p1Sets: 3, p2Sets: 2 },
    }),
  ];

  const champion = computeCategoryClassificationSummaries(matches, { athleteId: 100 })[0];
  const vice = computeCategoryClassificationSummaries(matches, { athleteId: 102 })[0];
  const semiLoser = computeCategoryClassificationSummaries(matches, { athleteId: 104 })[0];

  assert.equal(champion.position, 1);
  assert.equal(vice.position, 2);
  assert.equal(semiLoser.position, 3);
});

test("empate simples entre 2 atletas em grupo unico resolve por confronto direto", () => {
  const matches: CategoryAnalyticsMatch[] = [
    createMatch({
      phase: "GRUPOS",
      round: "Grupo unico",
      players: [{ athleteId: 10, name: "A" }, { athleteId: 11, name: "B" }],
      winnerIndex: 0,
      setsResult: { p1Sets: 3, p2Sets: 2 },
    }),
  ];

  const classA = computeCategoryClassificationSummaries(matches, { athleteId: 10 })[0];
  const classB = computeCategoryClassificationSummaries(matches, { athleteId: 11 })[0];
  assert.equal(classA.mode, "grupo_unico");
  assert.equal(classA.position, 1);
  assert.equal(classB.position, 2);
});

test("empate triplo resolve por razao de sets", () => {
  const matches: CategoryAnalyticsMatch[] = [
    createMatch({
      phase: "GRUPOS",
      round: "Grupo unico",
      players: [{ athleteId: 10, name: "A" }, { athleteId: 11, name: "B" }],
      winnerIndex: 0,
      setsResult: { p1Sets: 3, p2Sets: 2 },
    }),
    createMatch({
      phase: "GRUPOS",
      round: "Grupo unico",
      players: [{ athleteId: 11, name: "B" }, { athleteId: 12, name: "C" }],
      winnerIndex: 1,
      setsResult: { p1Sets: 2, p2Sets: 3 },
    }),
    createMatch({
      phase: "GRUPOS",
      round: "Grupo unico",
      players: [{ athleteId: 12, name: "C" }, { athleteId: 10, name: "A" }],
      winnerIndex: 1,
      setsResult: { p1Sets: 1, p2Sets: 3 },
    }),
  ];

  const classA = computeCategoryClassificationSummaries(matches, { athleteId: 10 })[0];
  const classB = computeCategoryClassificationSummaries(matches, { athleteId: 11 })[0];
  const classC = computeCategoryClassificationSummaries(matches, { athleteId: 12 })[0];

  assert.equal(classA.position, 1);
  assert.equal(classC.position, 2);
  assert.equal(classB.position, 3);
});

test("empate triplo resolve por razao de pontos", () => {
  const matches: CategoryAnalyticsMatch[] = [
    createMatch({
      phase: "GRUPOS",
      round: "Grupo unico",
      players: [{ athleteId: 10, name: "A" }, { athleteId: 11, name: "B" }],
      winnerIndex: 0,
      setsResult: { p1Sets: 3, p2Sets: 0 },
      sets: [
        { p1: 11, p2: 9 },
        { p1: 11, p2: 9 },
        { p1: 11, p2: 9 },
      ],
    }),
    createMatch({
      phase: "GRUPOS",
      round: "Grupo unico",
      players: [{ athleteId: 11, name: "B" }, { athleteId: 12, name: "C" }],
      winnerIndex: 0,
      setsResult: { p1Sets: 3, p2Sets: 0 },
      sets: [
        { p1: 11, p2: 8 },
        { p1: 11, p2: 8 },
        { p1: 11, p2: 8 },
      ],
    }),
    createMatch({
      phase: "GRUPOS",
      round: "Grupo unico",
      players: [{ athleteId: 12, name: "C" }, { athleteId: 10, name: "A" }],
      winnerIndex: 0,
      setsResult: { p1Sets: 3, p2Sets: 0 },
      sets: [
        { p1: 11, p2: 5 },
        { p1: 11, p2: 5 },
        { p1: 11, p2: 5 },
      ],
    }),
  ];

  const classA = computeCategoryClassificationSummaries(matches, { athleteId: 10 })[0];
  const classB = computeCategoryClassificationSummaries(matches, { athleteId: 11 })[0];
  const classC = computeCategoryClassificationSummaries(matches, { athleteId: 12 })[0];

  assert.equal(classA.position, 3);
  assert.equal(classB.position, 2);
  assert.equal(classC.position, 1);
});

test("empate parcial reexecuta desempate no subconjunto restante", () => {
  const matches: CategoryAnalyticsMatch[] = [
    createMatch({
      phase: "GRUPOS",
      round: "Grupo unico",
      players: [{ athleteId: 10, name: "A" }, { athleteId: 11, name: "B" }],
      winnerIndex: 0,
      setsResult: { p1Sets: 3, p2Sets: 0 },
      sets: [
        { p1: 11, p2: 9 },
        { p1: 11, p2: 9 },
        { p1: 11, p2: 9 },
      ],
    }),
    createMatch({
      phase: "GRUPOS",
      round: "Grupo unico",
      players: [{ athleteId: 10, name: "A" }, { athleteId: 12, name: "C" }],
      winnerIndex: 1,
      setsResult: { p1Sets: 2, p2Sets: 3 },
      sets: [
        { p1: 11, p2: 9 },
        { p1: 11, p2: 9 },
        { p1: 9, p2: 11 },
        { p1: 8, p2: 11 },
        { p1: 8, p2: 11 },
      ],
    }),
    createMatch({
      phase: "GRUPOS",
      round: "Grupo unico",
      players: [{ athleteId: 10, name: "A" }, { athleteId: 13, name: "D" }],
      winnerIndex: 0,
      setsResult: { p1Sets: 3, p2Sets: 0 },
      sets: [
        { p1: 11, p2: 7 },
        { p1: 11, p2: 7 },
        { p1: 11, p2: 7 },
      ],
    }),
    createMatch({
      phase: "GRUPOS",
      round: "Grupo unico",
      players: [{ athleteId: 11, name: "B" }, { athleteId: 12, name: "C" }],
      winnerIndex: 1,
      setsResult: { p1Sets: 0, p2Sets: 3 },
      sets: [
        { p1: 9, p2: 11 },
        { p1: 9, p2: 11 },
        { p1: 9, p2: 11 },
      ],
    }),
    createMatch({
      phase: "GRUPOS",
      round: "Grupo unico",
      players: [{ athleteId: 11, name: "B" }, { athleteId: 13, name: "D" }],
      winnerIndex: 0,
      setsResult: { p1Sets: 3, p2Sets: 0 },
      sets: [
        { p1: 11, p2: 8 },
        { p1: 11, p2: 8 },
        { p1: 11, p2: 8 },
      ],
    }),
    createMatch({
      phase: "GRUPOS",
      round: "Grupo unico",
      players: [{ athleteId: 12, name: "C" }, { athleteId: 13, name: "D" }],
      winnerIndex: 0,
      setsResult: { p1Sets: 3, p2Sets: 0 },
      sets: [
        { p1: 11, p2: 6 },
        { p1: 11, p2: 6 },
        { p1: 11, p2: 6 },
      ],
    }),
  ];

  const classA = computeCategoryClassificationSummaries(matches, { athleteId: 10 })[0];
  const classB = computeCategoryClassificationSummaries(matches, { athleteId: 11 })[0];
  const classC = computeCategoryClassificationSummaries(matches, { athleteId: 12 })[0];

  assert.equal(classC.position, 1);
  assert.equal(classA.position, 2);
  assert.equal(classB.position, 3);
});

test("empate absoluto usa sorteio deterministico", () => {
  const matches: CategoryAnalyticsMatch[] = [
    createMatch({
      phase: "GRUPOS",
      round: "Grupo unico",
      players: [{ athleteId: 10, name: "A" }, { athleteId: 11, name: "B" }],
      winnerIndex: null,
      setsResult: null,
      sets: [],
    }),
    createMatch({
      phase: "GRUPOS",
      round: "Grupo unico",
      players: [{ athleteId: 11, name: "B" }, { athleteId: 12, name: "C" }],
      winnerIndex: null,
      setsResult: null,
      sets: [],
    }),
    createMatch({
      phase: "GRUPOS",
      round: "Grupo unico",
      players: [{ athleteId: 12, name: "C" }, { athleteId: 10, name: "A" }],
      winnerIndex: null,
      setsResult: null,
      sets: [],
    }),
  ];

  const first = computeCategoryClassificationSummaries(matches, { athleteId: 10 })[0];
  const second = computeCategoryClassificationSummaries(matches, { athleteId: 10 })[0];
  assert.equal(first.position, second.position);
  assert.equal(first.tieTechnical, true);
});

test("grupo unico reconhece rodadas com sufixos de jogo no mesmo grupo", () => {
  const matches: CategoryAnalyticsMatch[] = [
    createMatch({
      phase: "GRUPOS",
      round: "Grupo 01 - Jogo 001",
      players: [{ athleteId: 10, name: "ANNA SOPHIA" }, { athleteId: 11, name: "B" }],
      winnerIndex: 0,
      setsResult: { p1Sets: 3, p2Sets: 0 },
    }),
    createMatch({
      phase: "GRUPOS",
      round: "Grupo 01 - Jogo 002",
      players: [{ athleteId: 10, name: "ANNA SOPHIA" }, { athleteId: 12, name: "C" }],
      winnerIndex: 1,
      setsResult: { p1Sets: 2, p2Sets: 3 },
    }),
  ];

  const classification = computeCategoryClassificationSummaries(matches, { athleteId: 10 })[0];
  assert.equal(classification.mode, "grupo_unico");
  assert.ok(typeof classification.position === "number" && classification.position >= 1);
});

test("grupo unico reconhece rodada no formato Única 01", () => {
  const matches: CategoryAnalyticsMatch[] = [
    createMatch({
      phase: "RESULTADOS",
      round: "Única 01",
      players: [{ athleteId: 10, name: "ANNA SOPHIA" }, { athleteId: 11, name: "B" }],
      winnerIndex: 0,
      setsResult: { p1Sets: 3, p2Sets: 1 },
    }),
    createMatch({
      phase: "RESULTADOS",
      round: "Única 01",
      players: [{ athleteId: 10, name: "ANNA SOPHIA" }, { athleteId: 12, name: "C" }],
      winnerIndex: 1,
      setsResult: { p1Sets: 2, p2Sets: 3 },
    }),
    createMatch({
      phase: "RESULTADOS",
      round: "Única 01",
      players: [{ athleteId: 11, name: "B" }, { athleteId: 12, name: "C" }],
      winnerIndex: 1,
      setsResult: { p1Sets: 0, p2Sets: 3 },
    }),
  ];

  const classification = computeCategoryClassificationSummaries(matches, { athleteId: 10 })[0];
  assert.equal(classification.mode, "grupo_unico");
  assert.equal(classification.position, 2);
});

test("grupo unico com mais de 5 atletas ainda classifica por grupo", () => {
  const matches: CategoryAnalyticsMatch[] = [
    createMatch({
      categoryId: 1086,
      categoryName: "SUB-11 FEM",
      phase: "RESULTADOS",
      round: "Única 01",
      players: [{ athleteId: 10, name: "ATLETA A" }, { athleteId: 11, name: "B" }],
      winnerIndex: 0,
      setsResult: { p1Sets: 3, p2Sets: 0 },
    }),
    createMatch({
      categoryId: 1086,
      categoryName: "SUB-11 FEM",
      phase: "RESULTADOS",
      round: "Única 01",
      players: [{ athleteId: 10, name: "ATLETA A" }, { athleteId: 12, name: "C" }],
      winnerIndex: 0,
      setsResult: { p1Sets: 3, p2Sets: 0 },
    }),
    createMatch({
      categoryId: 1086,
      categoryName: "SUB-11 FEM",
      phase: "RESULTADOS",
      round: "Única 01",
      players: [{ athleteId: 10, name: "ATLETA A" }, { athleteId: 13, name: "D" }],
      winnerIndex: 0,
      setsResult: { p1Sets: 3, p2Sets: 0 },
    }),
    createMatch({
      categoryId: 1086,
      categoryName: "SUB-11 FEM",
      phase: "RESULTADOS",
      round: "Única 01",
      players: [{ athleteId: 10, name: "ATLETA A" }, { athleteId: 14, name: "E" }],
      winnerIndex: 0,
      setsResult: { p1Sets: 3, p2Sets: 0 },
    }),
    createMatch({
      categoryId: 1086,
      categoryName: "SUB-11 FEM",
      phase: "RESULTADOS",
      round: "Única 01",
      players: [{ athleteId: 10, name: "ATLETA A" }, { athleteId: 15, name: "F" }],
      winnerIndex: 0,
      setsResult: { p1Sets: 3, p2Sets: 0 },
    }),
    createMatch({
      categoryId: 1086,
      categoryName: "SUB-11 FEM",
      phase: "RESULTADOS",
      round: "Única 01",
      players: [{ athleteId: 10, name: "ATLETA A" }, { athleteId: 16, name: "G" }],
      winnerIndex: 0,
      setsResult: { p1Sets: 3, p2Sets: 0 },
    }),
  ];

  const classification = computeCategoryClassificationSummaries(matches, { athleteId: 10 })[0];
  assert.equal(classification.mode, "grupo_unico");
  assert.equal(classification.position, 1);
});

test("grupo unico ignora partidas pendentes para manter classificacao", () => {
  const matches: CategoryAnalyticsMatch[] = [
    createMatch({
      categoryId: 1086,
      categoryName: "SUB-11 FEM",
      phase: "RESULTADOS",
      round: "Única 01",
      players: [{ athleteId: 10, name: "ATLETA A" }, { athleteId: 11, name: "B" }],
      winnerIndex: 0,
      setsResult: { p1Sets: 3, p2Sets: 0 },
    }),
    createMatch({
      categoryId: 1086,
      categoryName: "SUB-11 FEM",
      phase: "RESULTADOS",
      round: "Única 01",
      players: [{ athleteId: 10, name: "ATLETA A" }, { athleteId: 12, name: "C" }],
      winnerIndex: 1,
      setsResult: { p1Sets: 1, p2Sets: 3 },
    }),
    createMatch({
      categoryId: 1086,
      categoryName: "SUB-11 FEM",
      phase: "RESULTADOS",
      round: "Única 01",
      players: [{ athleteId: 11, name: "B" }, { athleteId: 12, name: "C" }],
      winnerIndex: 1,
      setsResult: { p1Sets: 0, p2Sets: 3 },
    }),
    createMatch({
      categoryId: 1086,
      categoryName: "SUB-11 FEM",
      phase: "RESULTADOS",
      round: "Única 01",
      players: [{ athleteId: 14, name: "E" }, { athleteId: 15, name: "F" }],
      winnerIndex: null,
      setsResult: null,
      sets: [],
    }),
  ];

  const classification = computeCategoryClassificationSummaries(matches, { athleteId: 10 })[0];
  assert.equal(classification.mode, "grupo_unico");
  assert.equal(classification.position, 2);
});

test("grupo unico com mais de 5 atletas ignora eliminatoria BYE sem vencedor", () => {
  const baseCategory = {
    categoryId: 2099,
    categoryName: "ABSOLUTO C FEM",
  };
  const matches: CategoryAnalyticsMatch[] = [
    createMatch({
      ...baseCategory,
      phase: "RESULTADOS",
      round: "Única 01",
      players: [{ athleteId: 10, name: "ATLETA A" }, { athleteId: 11, name: "B" }],
      winnerIndex: 0,
      setsResult: { p1Sets: 3, p2Sets: 0 },
    }),
    createMatch({
      ...baseCategory,
      phase: "RESULTADOS",
      round: "Única 01",
      players: [{ athleteId: 10, name: "ATLETA A" }, { athleteId: 12, name: "C" }],
      winnerIndex: 0,
      setsResult: { p1Sets: 3, p2Sets: 0 },
    }),
    createMatch({
      ...baseCategory,
      phase: "RESULTADOS",
      round: "Única 01",
      players: [{ athleteId: 10, name: "ATLETA A" }, { athleteId: 13, name: "D" }],
      winnerIndex: 0,
      setsResult: { p1Sets: 3, p2Sets: 0 },
    }),
    createMatch({
      ...baseCategory,
      phase: "RESULTADOS",
      round: "Única 01",
      players: [{ athleteId: 10, name: "ATLETA A" }, { athleteId: 14, name: "E" }],
      winnerIndex: 0,
      setsResult: { p1Sets: 3, p2Sets: 0 },
    }),
    createMatch({
      ...baseCategory,
      phase: "RESULTADOS",
      round: "Única 01",
      players: [{ athleteId: 10, name: "ATLETA A" }, { athleteId: 15, name: "F" }],
      winnerIndex: 0,
      setsResult: { p1Sets: 3, p2Sets: 0 },
    }),
    createMatch({
      ...baseCategory,
      phase: "RESULTADOS",
      round: "Única 01",
      players: [{ athleteId: 10, name: "ATLETA A" }, { athleteId: 16, name: "G" }],
      winnerIndex: 0,
      setsResult: { p1Sets: 3, p2Sets: 0 },
    }),
    createMatch({
      ...baseCategory,
      phase: "ELIMINATORIA",
      round: null,
      players: [{ athleteId: null, name: "BYE" }, { athleteId: null, name: "BYE" }],
      winnerIndex: null,
      setsResult: null,
      sets: [],
    }),
  ];

  const classification = computeCategoryClassificationSummaries(matches, { athleteId: 10 })[0];
  assert.equal(classification.mode, "grupo_unico");
  assert.equal(classification.position, 1);
});
