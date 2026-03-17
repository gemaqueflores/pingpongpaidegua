import assert from "node:assert/strict";
import test from "node:test";
import type { ParsedDataset } from "@cbtm/shared";
import {
  applyParenseEligibilityScopeToDataset,
  shouldApplyParenseScope,
} from "../src/pipeline/parense-scope";

function buildDataset(): ParsedDataset {
  return {
    categories: [
      {
        categoryId: "cat-1",
        categoryName: "ABSOLUTO A",
        categoryNormalizedName: "absoluto a",
        athleteCount: 2,
        expectedMedalistCount: 0,
        expectedMatchCount: 0,
      },
      {
        categoryId: "cat-2",
        categoryName: "ABSOLUTO B",
        categoryNormalizedName: "absoluto b",
        athleteCount: 2,
        expectedMedalistCount: 0,
        expectedMatchCount: 0,
      },
    ],
    registrations: [
      {
        categoryId: "cat-1",
        athleteName: "ATLETA PA",
        athleteNormalizedName: "atleta pa",
        clubName: "CLUBE PA",
        clubNormalizedName: "clube pa",
        categoryName: "ABSOLUTO A",
        categoryNormalizedName: "absoluto a",
        status: "INSCRITO",
        rankingPoints: null,
        ratingPoints: null,
      },
      {
        categoryId: "cat-2",
        athleteName: "ATLETA SP",
        athleteNormalizedName: "atleta sp",
        clubName: "CLUBE SP",
        clubNormalizedName: "clube sp",
        categoryName: "ABSOLUTO B",
        categoryNormalizedName: "absoluto b",
        status: "INSCRITO",
        rankingPoints: null,
        ratingPoints: null,
      },
    ],
    matches: [
      {
        categoryId: "cat-1",
        categoryName: "ABSOLUTO A",
        categoryNormalizedName: "absoluto a",
        phase: "RESULTADOS",
        round: "Final",
        matchKey: "cat-1-final",
        athleteAName: "ATLETA PA",
        athleteANormalizedName: "atleta pa",
        athleteAClubNormalizedName: "clube pa",
        athleteBName: "OUTRO PA",
        athleteBNormalizedName: "outro pa",
        athleteBClubNormalizedName: "clube pa",
        scoreRaw: "3-0",
        setsResult: { p1Sets: 3, p2Sets: 0 },
        scoreSets: [],
        matchDatetime: "2026-03-01T10:00:00.000Z",
        sourceFlags: ["RESULTADOS"],
      },
      {
        categoryId: "cat-2",
        categoryName: "ABSOLUTO B",
        categoryNormalizedName: "absoluto b",
        phase: "RESULTADOS",
        round: "Final",
        matchKey: "cat-2-final",
        athleteAName: "ATLETA SP",
        athleteANormalizedName: "atleta sp",
        athleteAClubNormalizedName: "clube sp",
        athleteBName: "OUTRO SP",
        athleteBNormalizedName: "outro sp",
        athleteBClubNormalizedName: "clube sp",
        scoreRaw: "3-1",
        setsResult: { p1Sets: 3, p2Sets: 1 },
        scoreSets: [],
        matchDatetime: "2026-03-01T11:00:00.000Z",
        sourceFlags: ["RESULTADOS"],
      },
    ],
    warnings: [],
    extractionStats: {},
  };
}

test("shouldApplyParenseScope limita o escopo a copa/nacional ou nome equivalente", () => {
  assert.equal(shouldApplyParenseScope("COPA", "qualquer"), true);
  assert.equal(shouldApplyParenseScope("NACIONAL", "qualquer"), true);
  assert.equal(shouldApplyParenseScope("ESTADUAL", "Brasileirao 2026"), true);
  assert.equal(shouldApplyParenseScope("ESTADUAL", "1TMB26"), false);
});

test("applyParenseEligibilityScopeToDataset recorta categorias elegiveis por clubes estaduais/open", () => {
  const warnings: string[] = [];
  const result = applyParenseEligibilityScopeToDataset({
    eventLevel: "COPA",
    eventName: "Copa Brasil",
    dataset: buildDataset(),
    eligibleClubNames: new Set(["clube pa"]),
    warnings,
  });

  assert.equal(result.stats.reason, "filtro_aplicado");
  assert.equal(result.dataset.categories.length, 1);
  assert.equal(result.dataset.registrations.length, 1);
  assert.equal(result.dataset.matches.length, 1);
  assert.equal(result.dataset.categories[0]?.categoryId, "cat-1");
  assert.match(warnings[0] ?? "", /filtro por categoria elegivel aplicado/i);
});

test("applyParenseEligibilityScopeToDataset preserva dataset quando recorte zera confrontos publicados", () => {
  const dataset = buildDataset();
  dataset.registrations = [];
  dataset.matches = [
    {
      categoryId: "cat-1",
      categoryName: "ABSOLUTO A",
      categoryNormalizedName: "absoluto a",
      phase: "RESULTADOS",
      round: "Final",
      matchKey: "cat-1-final",
      athleteAName: "ATLETA PA",
      athleteANormalizedName: "atleta pa",
      athleteAClubNormalizedName: "clube desconhecido",
      athleteBName: "OUTRO PA",
      athleteBNormalizedName: "outro pa",
      athleteBClubNormalizedName: "clube desconhecido",
      scoreRaw: "3-0",
      setsResult: { p1Sets: 3, p2Sets: 0 },
      scoreSets: [],
      matchDatetime: "2026-03-01T10:00:00.000Z",
      sourceFlags: ["RESULTADOS"],
    },
  ];

  const warnings: string[] = [];
  const result = applyParenseEligibilityScopeToDataset({
    eventLevel: "COPA",
    eventName: "Copa Brasil",
    dataset,
    eligibleClubNames: new Set(["clube pa"]),
    warnings,
  });

  assert.equal(result.stats.reason, "sem_categorias_elegiveis");
  assert.equal(result.dataset.matches.length, 1);
  assert.equal(result.dataset.categories.length, 2);
  assert.match(warnings[0] ?? "", /nenhuma categoria elegivel/i);
});
