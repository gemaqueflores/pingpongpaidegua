import { describe, expect, it } from "vitest";
import { normalizeClubName, normalizeText } from "../src/index";

describe("normalizeClubName", () => {
  it("T-U-01: unifica clube com e sem sufixo de UF no padrao '- PA'", () => {
    const withoutSuffix = normalizeClubName("ACADEMIA PING DRIVE LTDA");
    const withSuffix = normalizeClubName("ACADEMIA PING DRIVE LTDA - PA");
    expect(withoutSuffix).toBe(withSuffix);
  });

  it("T-U-01: unifica clube com e sem sufixo de UF no padrao '(PA)'", () => {
    const withParenSuffix = normalizeClubName("YOSHIDA TT - IGREJA CRISTA EVANGELICA DA AMAZONIA (PA)");
    const withDashSuffix = normalizeClubName("YOSHIDA TT - IGREJA CRISTA EVANGELICA DA AMAZONIA - PA");
    expect(withParenSuffix).toBe(withDashSuffix);
  });

  it("T-U-01: e case-insensitive e tolera variacao de espaco no sufixo", () => {
    const upper = normalizeClubName("TENIS DE MESA SALINAS -TDMS - PA");
    const lowerExtraSpace = normalizeClubName("tenis de mesa salinas -tdms   -   pa");
    expect(upper).toBe(lowerExtraSpace);
  });

  it("nao remove trecho que nao e sufixo de UF ao final", () => {
    expect(normalizeClubName("CLUBE PARANA ESPORTE CLUBE")).toContain("parana");
  });
});

describe("normalizeText (regressao)", () => {
  it("T-U-02: continua removendo apenas acentuacao/caixa/espaco, sem tocar em sufixo de UF", () => {
    expect(normalizeText("ACADEMIA PING DRIVE LTDA - PA")).toBe("academia ping drive ltda - pa");
    expect(normalizeText("  Categoria   Sub-15  ")).toBe("categoria sub-15");
    expect(normalizeText(null)).toBe("");
    expect(normalizeText(undefined)).toBe("");
  });
});
