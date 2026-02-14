import { describe, expect, it } from "vitest";
import { DxPayload, parseDxPayloads } from "../src/index";

function buildCard(lines: string[]): string {
  return `<div class="dxcvBreakpointsCard_MaterialCompact">${lines.join("\n")}</div>`;
}

describe("hints por categoria", () => {
  it("mantem ranking/rating corretos para nome reduzido quando ha colisao entre categorias", () => {
    const payloads: DxPayload[] = [
      {
        rawLiteral: "",
        html: buildCard([
          "JOAO PEDRO SILVA",
          "CLUBE A",
          "CAT A",
          "Inscrito",
          "10 pts. Ranking",
          "100 pts. Rating",
        ]),
        categoryId: "111",
        tab: "INSCRICOES",
        keys: [],
        callbackState: null,
        cardView: {
          controlId: null,
          pageIndex: null,
          pageCount: null,
          pageRowCount: null,
          pageRowSize: null,
        },
      },
      {
        rawLiteral: "",
        html: buildCard([
          "PEDRO SANTOS",
          "CLUBE A",
          "CAT A",
          "Inscrito",
          "20 pts. Ranking",
          "200 pts. Rating",
        ]),
        categoryId: "111",
        tab: "INSCRICOES",
        keys: [],
        callbackState: null,
        cardView: {
          controlId: null,
          pageIndex: null,
          pageCount: null,
          pageRowCount: null,
          pageRowSize: null,
        },
      },
      {
        rawLiteral: "",
        html: buildCard([
          "JOAO CARLOS SILVA",
          "CLUBE B",
          "CAT B",
          "Inscrito",
          "50 pts. Ranking",
          "500 pts. Rating",
        ]),
        categoryId: "222",
        tab: "INSCRICOES",
        keys: [],
        callbackState: null,
        cardView: {
          controlId: null,
          pageIndex: null,
          pageCount: null,
          pageRowCount: null,
          pageRowSize: null,
        },
      },
      {
        rawLiteral: "",
        html: buildCard([
          "CAT A - Final",
          "JOAO SILVA",
          "PEDRO SANTOS",
          "3-1",
          "01/01/2026",
          "Jogo 1 Mesa 2 09:00",
        ]),
        categoryId: "111",
        tab: "RESULTADOS",
        keys: [],
        callbackState: null,
        cardView: {
          controlId: null,
          pageIndex: null,
          pageCount: null,
          pageRowCount: null,
          pageRowSize: null,
        },
      },
    ];

    const dataset = parseDxPayloads(5246, payloads, {
      categoriesDiscovered: [
        { categoryId: "111", categoryName: "CAT A", valid: true },
        { categoryId: "222", categoryName: "CAT B", valid: true },
      ],
    });

    expect(dataset.matches.length).toBe(1);
    const match = dataset.matches[0];
    expect(match.athleteAName).toBe("JOAO SILVA");
    expect(match.athleteARankingPoints).toBe(10);
    expect(match.athleteARatingPoints).toBe(100);
    expect(match.athleteBRankingPoints).toBe(20);
    expect(match.athleteBRatingPoints).toBe(200);
  });

  it("parseia pontos com separador de milhar na inscricao", () => {
    const payloads: DxPayload[] = [
      {
        rawLiteral: "",
        html: buildCard([
          "ELDO DIAS BARBOSA",
          "PARA CLUBE - PA",
          "ROM",
          "Inscrito",
          "1.635 pts. Ranking",
          "2.040 pts. Rating",
        ]),
        categoryId: "333",
        tab: "INSCRICOES",
        keys: [],
        callbackState: null,
        cardView: {
          controlId: null,
          pageIndex: null,
          pageCount: null,
          pageRowCount: null,
          pageRowSize: null,
        },
      },
    ];

    const dataset = parseDxPayloads(5246, payloads, {
      categoriesDiscovered: [{ categoryId: "333", categoryName: "ROM", valid: true }],
    });

    expect(dataset.registrations.length).toBe(1);
    expect(dataset.registrations[0].rankingPoints).toBe(1635);
    expect(dataset.registrations[0].ratingPoints).toBe(2040);
  });
});
