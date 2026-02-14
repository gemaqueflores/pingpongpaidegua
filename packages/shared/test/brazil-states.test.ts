import { describe, expect, it } from "vitest";
import {
  inferBrazilStateFromClubName,
  inferBrazilStateFromClubNameDetailed,
  parseBrazilStateCodeFromClubName,
} from "../src/brazil-states";

describe("brazil state parser by club name", () => {
  it("parseia uf valida no padrao nome - UF", () => {
    expect(parseBrazilStateCodeFromClubName("CLUBE XYZ - SP")).toBe("SP");
  });

  it("aceita variacao de separador com dash unicode", () => {
    expect(parseBrazilStateCodeFromClubName("CLUBE XYZ–RJ")).toBe("RJ");
  });

  it("retorna null sem uf final", () => {
    expect(parseBrazilStateCodeFromClubName("CLUBE XYZ")).toBeNull();
  });

  it("retorna null para uf invalida", () => {
    expect(parseBrazilStateCodeFromClubName("CLUBE XYZ - XX")).toBeNull();
  });

  it("normaliza espacos extras", () => {
    expect(parseBrazilStateCodeFromClubName("  CLUBE   XYZ   -   mg   ")).toBe("MG");
  });

  it("retorna nome e regiao da uf inferida", () => {
    expect(inferBrazilStateFromClubName("ASSOCIACAO TESTE - PE")).toEqual({
      code: "PE",
      name: "Pernambuco",
      region: "Regiao Nordeste",
    });
  });

  it("aplica excecao de clube APTM para UF PA", () => {
    expect(parseBrazilStateCodeFromClubName("ASSOCIAÇÃO PARAENSE DE TÊNIS DE MESA -APTM")).toBe("PA");
    expect(inferBrazilStateFromClubName("ASSOCIAÇÃO PARAENSE DE TÊNIS DE MESA -APTM")).toEqual({
      code: "PA",
      name: "Para",
      region: "Regiao Norte",
    });
  });

  it("expoe origem de inferencia por excecao", () => {
    expect(inferBrazilStateFromClubNameDetailed("ASSOCIAÇÃO PARAENSE DE TÊNIS DE MESA -APTM")).toEqual({
      state: {
        code: "PA",
        name: "Para",
        region: "Regiao Norte",
      },
      source: "club_exception",
    });
  });
});
