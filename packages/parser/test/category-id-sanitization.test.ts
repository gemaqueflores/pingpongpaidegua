import { describe, expect, it } from "vitest";
import { parseDxPayloads, type DxPayload } from "../src/index";

function makeInscricaoPayload(input: {
  categoryId: string;
  athleteName: string;
  clubName: string;
  categoryLine: string;
  statusLine: string;
}): DxPayload {
  const lines = [
    input.athleteName,
    input.clubName,
    input.categoryLine,
    input.statusLine,
    "100 pts. Ranking",
    "120 pts. Rating",
  ].join("\n");

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

describe("sanitizacao de categoryId em inscricoes", () => {
  it("ignora categoryId desconhecido da lista descoberta e evita colisoes entre categorias", () => {
    const p1 = makeInscricaoPayload({
      categoryId: "345726",
      athleteName: "ATLETA TESTE",
      clubName: "CLUBE A",
      categoryLine: "MASTER 35MAS",
      statusLine: "Inscrito",
    });
    const p2 = makeInscricaoPayload({
      categoryId: "345726",
      athleteName: "ATLETA TESTE",
      clubName: "CLUBE A",
      categoryLine: "RGM",
      statusLine: "Pré-inscrito",
    });

    const dataset = parseDxPayloads(5368, [p1, p2], {
      categoriesDiscovered: [
        { categoryId: "257", categoryName: "MASTER 35MAS", valid: true },
        { categoryId: "1049", categoryName: "RGM", valid: true },
      ],
    });

    expect(dataset.registrations).toHaveLength(2);
    expect(dataset.registrations.map((item) => item.categoryName).sort()).toEqual(["MASTER 35MAS", "RGM"]);
    expect(dataset.registrations.every((item) => item.categoryId == null)).toBe(true);
    expect(
      dataset.warnings.some((warning) => warning.includes("categoryId fora da lista descoberta")),
    ).toBe(true);
  });

  it("mantem categoryId conhecido e prioriza categoria descoberta quando disponivel", () => {
    const payload = makeInscricaoPayload({
      categoryId: "257",
      athleteName: "ATLETA TESTE",
      clubName: "CLUBE A",
      categoryLine: "CATEGORIA ERRADA",
      statusLine: "Inscrito",
    });

    const dataset = parseDxPayloads(5368, [payload], {
      categoriesDiscovered: [{ categoryId: "257", categoryName: "MASTER 35MAS", valid: true }],
    });

    expect(dataset.registrations).toHaveLength(1);
    expect(dataset.registrations[0].categoryId).toBe("257");
    expect(dataset.registrations[0].categoryName).toBe("MASTER 35MAS");
  });
});
