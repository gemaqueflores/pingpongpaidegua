import { describe, expect, it } from "vitest";
import { computeOfficialCategoryMatchesCount } from "../src";

describe("computeOfficialCategoryMatchesCount", () => {
  it("PP-025 T-U-01 aplica K1 do evento sem depender do prefixo da categoria", () => {
    expect(
      computeOfficialCategoryMatchesCount(4, {
        categoryName: "ABSOLUTO A MAS",
        competitionFormat: "K1",
      }),
    ).toBe(3);
  });

  it("categorias rating apos 2026-02-24 usam eliminatoria simples", () => {
    expect(
      computeOfficialCategoryMatchesCount(16, {
        categoryName: "RIM",
        eventStartDate: "2026-02-24",
      }),
    ).toBe(15);
  });

  it("categorias rating antes de 2026-02-24 mantem regra legado", () => {
    expect(
      computeOfficialCategoryMatchesCount(16, {
        categoryName: "RIM",
        eventStartDate: "2026-02-23",
      }),
    ).toBe(27);
  });

  it("permite forcar RR+k1 para rating via configuracao do evento", () => {
    expect(
      computeOfficialCategoryMatchesCount(16, {
        categoryName: "RIM",
        eventStartDate: "2026-02-24",
        ratingMatchFormat: "RR_K1",
      }),
    ).toBe(27);
  });
});
