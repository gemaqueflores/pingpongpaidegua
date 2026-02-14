import { describe, expect, it } from "vitest";
import { parseDxPayloads, type DxPayload } from "../src/index";
import { normalizeText } from "@cbtm/shared";

function makeInscricaoPayload(input: {
  categoryId: string;
  athleteName: string;
  clubName: string;
  categoryLine: string;
  statusLine: string;
  extraLine?: string;
}): DxPayload {
  const lines = [
    input.athleteName,
    input.clubName,
    input.categoryLine,
    input.extraLine ?? "",
    input.statusLine,
    "100 pts. Ranking",
    "120 pts. Rating",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    rawLiteral: "{}",
    html: `<div id="EventoTabPage_Inscricoes"><div class="dxcvBreakpointsCard_MaterialCompact">${lines}</div></div>`,
    categoryId: input.categoryId,
    tab: "INSCRICOES",
    keys: [],
    callbackState: null,
    cardView: {
      controlId: null,
      pageIndex: 0,
      pageCount: 1,
      pageRowCount: 1,
      pageRowSize: 1,
    },
  };
}

describe("parser inscrições em evento aberto", () => {
  it("força categoria do payload quando categoryId está presente", () => {
    const payload = makeInscricaoPayload({
      categoryId: "2001",
      athleteName: "JEFERSON ALMEIDA",
      clubName: "CLUBE A",
      categoryLine: "SUB-11 MAS",
      statusLine: "Inscrito",
    });

    const dataset = parseDxPayloads(5368, [payload], {
      categoriesDiscovered: [
        {
          categoryId: "2001",
          categoryName: "ADULTO MAS",
          valid: true,
        },
      ],
    });

    expect(dataset.registrations).toHaveLength(1);
    expect(dataset.registrations[0].categoryName).toBe("ADULTO MAS");
    expect(dataset.registrations[0].categoryNormalizedName).toBe(normalizeText("ADULTO MAS"));
  });

  it("deduplica inscrição por categoryId mesmo com nomes de categoria divergentes", () => {
    const p1 = makeInscricaoPayload({
      categoryId: "3001",
      athleteName: "JEFERSON ALMEIDA",
      clubName: "CLUBE A",
      categoryLine: "ADULTO MAS",
      statusLine: "Pré-inscrito",
    });
    const p2 = makeInscricaoPayload({
      categoryId: "3001",
      athleteName: "JEFERSON ALMEIDA",
      clubName: "CLUBE A",
      categoryLine: "ADULTO MASCULINO",
      statusLine: "Pré-inscrito",
    });

    const dataset = parseDxPayloads(5368, [p1, p2]);
    expect(dataset.registrations).toHaveLength(1);
    expect(dataset.registrations[0].categoryId).toBe("3001");
  });

  it("identifica status de inscrição mesmo quando não está na quarta linha", () => {
    const payload = makeInscricaoPayload({
      categoryId: "4001",
      athleteName: "JEFERSON ALMEIDA",
      clubName: "CLUBE A",
      categoryLine: "ADULTO MAS",
      extraLine: "Linha extra de observação",
      statusLine: "Pré-inscrito",
    });

    const dataset = parseDxPayloads(5368, [payload]);
    expect(dataset.registrations).toHaveLength(1);
    expect(dataset.registrations[0].status).toMatch(/pré-inscrito/i);
  });
});
