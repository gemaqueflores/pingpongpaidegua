import { describe, expect, it } from "vitest";
import {
  isDoublesLikeLabel,
  normalizeDoublesPairName,
  shouldNormalizeDoublesPairName,
} from "../src";

describe("doubles pair name helpers", () => {
  it("normaliza dupla com hashtag em ordem canonica", () => {
    expect(normalizeDoublesPairName("BRUNO FILHO # ANTONIO MATOS")).toBe(
      "ANTONIO MATOS # BRUNO FILHO",
    );
  });

  it("deduplica nomes repetidos na dupla", () => {
    expect(normalizeDoublesPairName("ANA # ANA # BIA")).toBe("ANA # BIA");
  });

  it("detecta labels de dupla", () => {
    expect(isDoublesLikeLabel("DUPLA MISTA")).toBe(true);
    expect(isDoublesLikeLabel("Evento de duplas")).toBe(true);
    expect(isDoublesLikeLabel("ABSOLUTO A (MAS)")).toBe(false);
  });

  it("normaliza somente quando contexto ou categoria sao de dupla", () => {
    expect(shouldNormalizeDoublesPairName("2TMB26 - DUPLAS", "SUB-15 MAS", "A # B")).toBe(true);
    expect(shouldNormalizeDoublesPairName("2TMB26", "DUPLA MISTA", "A # B")).toBe(true);
    expect(shouldNormalizeDoublesPairName("2TMB26", "SUB-15 MAS", "A # B")).toBe(false);
    expect(shouldNormalizeDoublesPairName("2TMB26", "SUB-15 MAS", "A")).toBe(false);
  });
});

