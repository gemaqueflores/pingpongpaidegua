import { describe, expect, it } from "vitest";
import {
  extractWarningCode,
  isOperationalRecoveryWarning,
} from "../src/index";

describe("warning policy", () => {
  it("extrai o codigo do warning persistido", () => {
    expect(
      extractWarningCode("AUDITORIA_PARTIDAS_DIVERGENCIA: 2 categoria(s) com divergencia."),
    ).toBe("AUDITORIA_PARTIDAS_DIVERGENCIA");
  });

  it("reconhece sinais operacionais de recovery", () => {
    expect(
      isOperationalRecoveryWarning("HTTP_DEGRADED_RESULTS: fallback para browser."),
    ).toBe(true);
    expect(
      isOperationalRecoveryWarning("AUDITORIA_CONFLITOS_PENDENTES: 4 conflito(s)."),
    ).toBe(true);
    expect(
      isOperationalRecoveryWarning("RESULTADOS diagnostico 'RHM' (1050): com_sets=6."),
    ).toBe(false);
  });
});
