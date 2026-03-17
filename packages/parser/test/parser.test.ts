import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeMatchKey } from "@cbtm/shared";
import { extractDxPayloads, parseResultsText } from "../src/index";

describe("parser DX", () => {
  const fixturePath = path.resolve(fileURLToPath(new URL("../../../fixtures/results.txt", import.meta.url)));
  const fixture = fs.readFileSync(fixturePath, "utf8");

  it("deve extrair payloads DX com html", () => {
    const payloads = extractDxPayloads(fixture);

    expect(payloads.length).toBeGreaterThan(0);
    expect(payloads.some((p) => p.tab === "INSCRICOES")).toBe(true);
    expect(payloads.some((p) => p.tab === "GRUPOS")).toBe(true);
    expect(payloads.some((p) => p.tab === "RESULTADOS")).toBe(true);
  });

  it("deve gerar dataset normalizado sem duplicar match_key", () => {
    const dataset = parseResultsText(5246, fixture);

    expect(dataset.registrations.length).toBeGreaterThan(0);
    expect(dataset.matches.length).toBeGreaterThan(0);
    expect(dataset.categories.length).toBeGreaterThan(0);

    const keys = dataset.matches.map((m) => m.matchKey);
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);

    const first = dataset.registrations[0];
    expect(first.athleteNormalizedName).toBe(first.athleteNormalizedName.trim());
    expect(first.athleteNormalizedName).toBe(first.athleteNormalizedName.toLowerCase());
    expect(first.rankingPoints).not.toBeNull();
    expect(first.ratingPoints).not.toBeNull();
    expect(dataset.extractionStats.totalCategoriesFound).toBeGreaterThan(0);
    expect(dataset.extractionStats.totalCategoriesValid).toBeGreaterThan(0);
    expect(dataset.extractionStats.categoriesScanned).toBeGreaterThan(0);
    expect(dataset.extractionStats.tabPayloadCounts.INSCRICOES).toBeGreaterThan(0);
    expect(dataset.matches.some((m) => m.phase === "RESULTADOS")).toBe(true);
    expect(dataset.matches.some((m) => m.phase === "ELIMINATORIA")).toBe(false);
  });

  it("deve manter match_key deterministico", () => {
    const key1 = computeMatchKey({
      eventId: 5246,
      categoryNormalized: "absoluto e (mas)",
      phase: "RESULTADOS",
      round: "Final",
      tableNumber: "1",
      matchDatetime: "2025-11-30T09:00:00.000Z",
      athleteA: "victor martins",
      athleteB: "davi furtado",
    });

    const key2 = computeMatchKey({
      eventId: 5246,
      categoryNormalized: "absoluto e (mas)",
      phase: "RESULTADOS",
      round: "Final",
      tableNumber: "1",
      matchDatetime: "2025-11-30T09:00:00.000Z",
      athleteA: "davi furtado",
      athleteB: "victor martins",
    });

    expect(key1).toBe(key2);
  });

  it("extrai placar por sets e winnerIndex quando card possui detalhes", () => {
    const dataset = parseResultsText(5246, fixture);
    const matchWithSets = dataset.matches.find((match) => (match.sets?.length ?? 0) > 0);

    expect(matchWithSets).toBeDefined();
    expect(matchWithSets?.sets?.length ?? 0).toBeGreaterThan(0);
    expect(matchWithSets?.sets?.every((set) => Number.isFinite(set.p1) && Number.isFinite(set.p2))).toBe(true);
    expect(
      matchWithSets?.winnerIndex === 0 ||
        matchWithSets?.winnerIndex === 1 ||
        matchWithSets?.winnerIndex === null,
    ).toBe(true);
  });
});

