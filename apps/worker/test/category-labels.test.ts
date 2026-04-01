import assert from "node:assert/strict";
import test from "node:test";
import { canonicalizeDatasetCategoryNames, canonicalizeEventScopedCategoryName } from "../src/pipeline/category-labels";

test("mantem categoria inalterada fora de evento de duplas mistas", () => {
  assert.equal(canonicalizeEventScopedCategoryName("2TMB26 - INDIVIDUAL", "ABSOLUTO B"), "ABSOLUTO B");
});

test("canoniza absolutos de dupla mista em formato consistente", () => {
  assert.equal(canonicalizeEventScopedCategoryName("2TMB26 - DUPLAS MISTAS", "ABSOLUTO B"), "DUPLA MISTA-ABSOLUTO B");
  assert.equal(
    canonicalizeEventScopedCategoryName("2TMB26 - DUPLAS MISTAS", "ABSOLUTO E- DUPLA MISTA"),
    "DUPLA MISTA-ABSOLUTO E",
  );
});

test("canoniza dataset inteiro em evento de duplas mistas", () => {
  const dataset = canonicalizeDatasetCategoryNames("2TMB26 - DUPLAS MISTAS", {
    categories: [
      {
        categoryId: "1",
        categoryName: "ABSOLUTO C",
        categoryNormalizedName: "absoluto c",
        valid: true,
        source: "SCRAPER",
      },
    ],
    registrations: [
      {
        categoryId: "1",
        athleteName: "A # B",
        athleteNormalizedName: "a # b",
        clubName: "CLUBE",
        clubNormalizedName: "clube",
        categoryName: "ABSOLUTO C",
        categoryNormalizedName: "absoluto c",
        status: "INSCRITO",
        rankingPoints: null,
        ratingPoints: null,
      },
    ],
    matches: [
      {
        categoryId: "1",
        phase: "RESULTADOS",
        categoryName: "ABSOLUTO C",
        categoryNormalizedName: "absoluto c",
        round: "Final",
        tableNumber: "1",
        matchDatetime: null,
        scoreRaw: "3-0",
        athleteAName: "A # B",
        athleteANormalizedName: "a # b",
        athleteBName: "C # D",
        athleteBNormalizedName: "c # d",
        matchKey: "k1",
      },
    ],
    warnings: [],
    extractionStats: {
      totalCategoriesFound: 1,
      totalCategoriesValid: 1,
      categoriesScanned: 1,
      tabPayloadCounts: {},
      tabItemCounts: {},
      categoryTabPayloadCounts: {},
      registrationsByCategory: {},
      matchesByCategoryPhase: {},
      uniqueAthletesConsolidated: 0,
    },
  });

  assert.equal(dataset.categories[0]?.categoryName, "DUPLA MISTA-ABSOLUTO C");
  assert.equal(dataset.registrations[0]?.categoryName, "DUPLA MISTA-ABSOLUTO C");
  assert.equal(dataset.matches[0]?.categoryName, "DUPLA MISTA-ABSOLUTO C");
  assert.equal(dataset.matches[0]?.categoryNormalizedName, "dupla mista-absoluto c");
});
