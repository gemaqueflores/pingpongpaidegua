import { describe, expect, it } from "vitest";
import { parseDxPayloads, type DxPayload } from "../src/index";
import { normalizeText } from "@cbtm/shared";

function makeInscricaoPayload(input: {
  categoryId: string | null;
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

describe("parser inscricoes em evento aberto", () => {
  it("forca categoria do payload quando categoryId esta presente", () => {
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

  it("deduplica inscricao por categoryId mesmo com nomes de categoria divergentes", () => {
    const p1 = makeInscricaoPayload({
      categoryId: "3001",
      athleteName: "JEFERSON ALMEIDA",
      clubName: "CLUBE A",
      categoryLine: "ADULTO MAS",
      statusLine: "Pre-inscrito",
    });
    const p2 = makeInscricaoPayload({
      categoryId: "3001",
      athleteName: "JEFERSON ALMEIDA",
      clubName: "CLUBE A",
      categoryLine: "ADULTO MASCULINO",
      statusLine: "Pre-inscrito",
    });

    const dataset = parseDxPayloads(5368, [p1, p2]);
    expect(dataset.registrations).toHaveLength(1);
    expect(dataset.registrations[0].categoryId).toBe("3001");
  });

  it("identifica status de inscricao mesmo quando nao esta na quarta linha", () => {
    const payload = makeInscricaoPayload({
      categoryId: "4001",
      athleteName: "JEFERSON ALMEIDA",
      clubName: "CLUBE A",
      categoryLine: "ADULTO MAS",
      extraLine: "Linha extra de observacao",
      statusLine: "Pre-inscrito",
    });

    const dataset = parseDxPayloads(5368, [payload]);
    expect(dataset.registrations).toHaveLength(1);
    expect(dataset.registrations[0].status).toMatch(/pre-inscrito/i);
  });

  it("normaliza sufixo dinamico de inscritos e pre-inscritos quando categoryId nao vem", () => {
    const p1 = makeInscricaoPayload({
      categoryId: null,
      athleteName: "JEFERSON ALMEIDA",
      clubName: "CLUBE A",
      categoryLine: "SUB-11 FEM 3 inscrito(s) 4 pre-inscrito(s)",
      statusLine: "Pre-inscrito",
    });
    const p2 = makeInscricaoPayload({
      categoryId: null,
      athleteName: "JEFERSON ALMEIDA",
      clubName: "CLUBE A",
      categoryLine: "SUB-11 FEM 5 inscrito(s) 1 pre-inscrito(s)",
      statusLine: "Pre-inscrito",
    });

    const dataset = parseDxPayloads(5368, [p1, p2]);
    expect(dataset.registrations).toHaveLength(1);
    expect(dataset.registrations[0].categoryName).toBe("SUB-11 FEM");
    expect(dataset.registrations[0].categoryNormalizedName).toBe(normalizeText("SUB-11 FEM"));
  });
});
