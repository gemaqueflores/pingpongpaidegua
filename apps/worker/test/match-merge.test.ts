import assert from "node:assert/strict";
import test from "node:test";
import { ParsedMatch } from "@cbtm/shared";
import {
  ScrapeProcessor,
  shouldClearCompetitiveDataOnManualStage2,
} from "../src/pipeline/scrape.processor";
import { mergeMatchesAcrossSources } from "../src/pipeline/match-merge";

let matchCounter = 0;

function buildMatch(overrides: Partial<ParsedMatch>): ParsedMatch {
  const athleteAName = overrides.athleteAName ?? "ATLETA A";
  const athleteBName = overrides.athleteBName ?? "ATLETA B";
  return {
    categoryId: "67",
    phase: "ELIMINATORIA",
    categoryName: "SUB-21 MAS",
    categoryNormalizedName: "sub-21 mas",
    round: "Quartas de Final",
    tableNumber: "4",
    matchDatetime: "2026-03-21T13:00:00.000Z",
    scoreRaw: "3-1",
    athleteAName,
    athleteANormalizedName: athleteAName.toLowerCase(),
    athleteBName,
    athleteBNormalizedName: athleteBName.toLowerCase(),
    matchKey: overrides.matchKey ?? `key-${++matchCounter}`,
    sets: [],
    setsResult: { p1Sets: 3, p2Sets: 1 },
    winnerIndex: 0,
    sourceUrl: "https://app.cbtm.org.br/IUI/App/Evento?EVE_Evento_ID=5246",
    metadata: { jogo: 10 },
    ...overrides,
  };
}

test("merge resultados + eliminatoria em um unico jogo com sourceFlags combinados", () => {
  const fromResultados = buildMatch({
    matchKey: "res-1",
    athleteAName: "DOMINI SILVA",
    athleteANormalizedName: "domini silva",
    athleteBName: "DAVI SOUZA",
    athleteBNormalizedName: "davi souza",
    scoreRaw: "3-1 (11-8, 11-9, 9-11, 11-7)",
    sets: [
      { p1: 11, p2: 8 },
      { p1: 11, p2: 9 },
      { p1: 9, p2: 11 },
      { p1: 11, p2: 7 },
    ],
    setsResult: { p1Sets: 3, p2Sets: 1 },
    sourceFlags: { resultados: true, eliminatoria: false },
    metadata: { jogo: 10, source: "card-view" },
  });

  const fromEliminatoria = buildMatch({
    matchKey: "elim-1",
    athleteAName: "DAVI SOUZA",
    athleteANormalizedName: "davi souza",
    athleteBName: "DOMINI SILVA",
    athleteBNormalizedName: "domini silva",
    scoreRaw: "1-3",
    sets: [],
    setsResult: { p1Sets: 1, p2Sets: 3 },
    sourceUrl: "https://app.cbtm.org.br/api/GameResult/5246/67",
    metadata: { jogo: 10, source: "api-game-result" },
  });

  const merged = mergeMatchesAcrossSources(5246, [fromResultados, fromEliminatoria]);
  assert.equal(merged.matches.length, 1);
  assert.equal(merged.warnings.length, 0);

  const match = merged.matches[0];
  assert.equal(match.cbtmMatchId, "10");
  assert.equal(match.scoreRaw, "3-1 (11-8, 11-9, 9-11, 11-7)");
  assert.deepEqual(match.setsResult, { p1Sets: 3, p2Sets: 1 });
  assert.equal(match.winnerIndex, 0);
  assert.equal(match.sourceFlags?.resultados, true);
  assert.equal(match.sourceFlags?.eliminatoria, true);
  assert.equal(match.sets?.length, 4);
});

test("merge preserva scoreSets quando apenas uma fonte possui pontos por set", () => {
  const noSets = buildMatch({
    matchKey: "res-2",
    scoreRaw: "3-2",
    sets: [],
    setsResult: { p1Sets: 3, p2Sets: 2 },
    sourceFlags: { resultados: true, eliminatoria: false },
  });

  const withSets = buildMatch({
    matchKey: "elim-2",
    scoreRaw: "3-2 (11-8, 8-11, 11-7, 9-11, 11-9)",
    sets: [
      { p1: 11, p2: 8 },
      { p1: 8, p2: 11 },
      { p1: 11, p2: 7 },
      { p1: 9, p2: 11 },
      { p1: 11, p2: 9 },
    ],
    sourceUrl: "https://app.cbtm.org.br/api/GameResult/5246/67",
    metadata: { jogo: 10, source: "api-game-result" },
  });

  const merged = mergeMatchesAcrossSources(5246, [noSets, withSets]);
  assert.equal(merged.matches.length, 1);
  assert.equal(merged.matches[0].sets?.length, 5);
});

test("merge registra warning em divergencia de datetime e escolhe data da fonte mais confiavel", () => {
  const eliminatoria = buildMatch({
    matchKey: "elim-dt",
    sourceUrl: "https://app.cbtm.org.br/api/GameResult/5246/67",
    metadata: { jogo: 10, source: "api-game-result" },
    matchDatetime: "2026-03-21T09:30:00.000Z",
  });

  const resultados = buildMatch({
    matchKey: "res-dt",
    sourceFlags: { resultados: true, eliminatoria: false },
    metadata: { jogo: 10, source: "card-view" },
    matchDatetime: "2026-03-21T10:15:00.000Z",
  });

  const merged = mergeMatchesAcrossSources(5246, [eliminatoria, resultados]);
  assert.equal(merged.matches.length, 1);
  assert.ok(merged.warnings.some((warning) => warning.includes("datetime divergente")));
  assert.equal(merged.matches[0].matchDatetime, "2026-03-21T10:15:00.000Z");
});

test("merge nao junta participantes diferentes na mesma identidade cbtm", () => {
  const original = buildMatch({
    matchKey: "m-1",
    athleteAName: "ALANO QUEIROZ",
    athleteANormalizedName: "alano queiroz",
    athleteBName: "MOACIR CATETE",
    athleteBNormalizedName: "moacir catete",
    metadata: { jogo: 55, source: "card-view" },
  });

  const conflicting = buildMatch({
    matchKey: "m-2",
    athleteAName: "OUTRO ATLETA",
    athleteANormalizedName: "outro atleta",
    athleteBName: "SEGUNDO ATLETA",
    athleteBNormalizedName: "segundo atleta",
    metadata: { jogo: 55, source: "api-game-result" },
  });

  const merged = mergeMatchesAcrossSources(5246, [original, conflicting]);
  assert.equal(merged.matches.length, 2);
  assert.ok(
    merged.warnings.some((warning) => warning.includes("conflito de participantes")),
  );
});

test("merge prioriza registro mais completo de RESULTADOS em conflito com ELIMINATORIA", () => {
  const resultadosFull = buildMatch({
    matchKey: "res-full",
    phase: "RESULTADOS",
    tableNumber: "9",
    round: "Quartas de Final",
    matchDatetime: "2026-03-21T14:30:00.000Z",
    scoreRaw: "3-1 (11-9, 8-11, 11-7, 11-6)",
    sets: [
      { p1: 11, p2: 9 },
      { p1: 8, p2: 11 },
      { p1: 11, p2: 7 },
      { p1: 11, p2: 6 },
    ],
    sourceFlags: { resultados: true, eliminatoria: false },
    metadata: { jogo: 77, source: "card-view" },
  });

  const eliminatoriaPobre = buildMatch({
    matchKey: "elim-poor",
    phase: "ELIMINATORIA",
    tableNumber: null,
    round: null,
    matchDatetime: null,
    scoreRaw: "3-1",
    sets: [],
    sourceUrl: "https://app.cbtm.org.br/api/GameResult/5246/67",
    metadata: { jogo: 77, source: "api-game-result" },
  });

  const merged = mergeMatchesAcrossSources(5246, [eliminatoriaPobre, resultadosFull]);
  assert.equal(merged.matches.length, 1);
  const match = merged.matches[0];
  assert.equal(match.phase, "RESULTADOS");
  assert.equal(match.tableNumber, "9");
  assert.equal(match.matchDatetime, "2026-03-21T14:30:00.000Z");
  assert.equal(match.round, "Quartas de Final");
  assert.equal(match.sets?.length ?? 0, 4);
});

test("merge normaliza fase legada ELIMINATORIA para RESULTADOS antes do upsert", () => {
  const onlyLegacyElimination = buildMatch({
    matchKey: "legacy-only",
    phase: "ELIMINATORIA",
    sourceUrl: "https://app.cbtm.org.br/api/GameResult/5246/67",
    metadata: { jogo: 91, source: "api-game-result" },
    scoreRaw: "3-0",
    sets: [],
    setsResult: { p1Sets: 3, p2Sets: 0 },
  });

  const merged = mergeMatchesAcrossSources(5246, [onlyLegacyElimination]);
  assert.equal(merged.matches.length, 1);
  assert.equal(merged.matches[0].phase, "RESULTADOS");
  assert.equal(merged.matches[0].sourceFlags?.eliminatoria, true);
});

test("persistencia de warnings preserva auditoria acionavel e remove diagnostico ruidoso", () => {
  const processor = new ScrapeProcessor() as unknown as {
    buildPersistedWarnings(rawWarnings: string[]): string[];
  };

  const persisted = processor.buildPersistedWarnings([
    "AUDITORIA_PARTIDAS_DIVERGENCIA: 2 categoria(s) com divergencia de partidas.",
    "HTTP_DEGRADED_RESULTS: fallback para browser.",
    "RESULTADOS diagnostico 'RHM' (1050): com_sets=6, sem_sets=0.",
    "POST_SCRAPE_SUMMARY: warnings(high=1, medium=0, low=2); conflicts(pool=0, sem_candidatos_pool=0, analisados=0, resolvidos=0, alias_exato=0, ambiguos=0, invalidos=0, backlog=0, disabled=nao).",
  ]);

  assert.ok(
    persisted.some((warning) => warning.startsWith("AUDITORIA_PARTIDAS_DIVERGENCIA:")),
  );
  assert.ok(
    persisted.some((warning) => warning.startsWith("HTTP_DEGRADED_RESULTS:")),
  );
  assert.ok(
    persisted.some((warning) => warning.startsWith("POST_SCRAPE_SUMMARY:")),
  );
  assert.equal(
    persisted.some((warning) => warning.startsWith("RESULTADOS diagnostico")),
    false,
  );
  assert.ok(
    persisted.some((warning) => warning.startsWith("WARNINGS_FILTRADOS_RUIDO:")),
  );
});

test("stage 2 manual preserva confrontos quando o evento ja tem grades ou jogos publicados", () => {
  assert.equal(shouldClearCompetitiveDataOnManualStage2("GRADES_PUBLICADAS_PRE_JOGO"), false);
  assert.equal(shouldClearCompetitiveDataOnManualStage2("EM_ANDAMENTO"), false);
  assert.equal(shouldClearCompetitiveDataOnManualStage2("POS_EVENTO"), false);
});

test("stage 2 manual pode limpar confrontos apenas antes da fase de jogo", () => {
  assert.equal(shouldClearCompetitiveDataOnManualStage2("PRE_INSCRICOES"), true);
  assert.equal(shouldClearCompetitiveDataOnManualStage2("INSCRICOES_ABERTAS"), true);
  assert.equal(shouldClearCompetitiveDataOnManualStage2("POS_INSCRICOES_PRE_EVENTO"), true);
});
