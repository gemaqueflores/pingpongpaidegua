import { describe, expect, it } from "vitest";
import { DxPayload, parseDxPayloads } from "../src/index";

function makePayload(html: string): DxPayload {
  return {
    rawLiteral: "{}",
    html,
    categoryId: "777",
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
  };
}

const richCardHtml = `
<div class="dxcvBreakpointsCard_MaterialCompact">
SUB-13 MAS - Quartas de Final
3-1
Jogo 019 - Mesa 4 - 07:13
29/11/2025
JOAO LIMA
3
11
7
11
11
LUCAS MENEZES
1
7
11
9
4
</div>
`;

const poorCardHtml = `
<div class="dxcvBreakpointsCard_MaterialCompact">
SUB-13 MAS - Quartas de Final
3-1
Jogo 019 - Mesa 4 - 07:13
29/11/2025
JOAO LIMA
3
LUCAS MENEZES
1
</div>
`;

describe("deduplicacao de parser preserva match mais rico", () => {
  it("mantem sets quando o registro completo chega por ultimo", () => {
    const dataset = parseDxPayloads(5246, [makePayload(poorCardHtml), makePayload(richCardHtml)]);
    expect(dataset.matches).toHaveLength(1);
    expect(dataset.matches[0].sets?.length ?? 0).toBeGreaterThan(0);
    expect(dataset.matches[0].setsResult).toEqual({ p1Sets: 3, p2Sets: 1 });
    expect(dataset.warnings.some((item) => item.includes("Deduplicacao de parser consolidou"))).toBe(true);
  });

  it("mantem sets quando o registro completo chega primeiro", () => {
    const dataset = parseDxPayloads(5246, [makePayload(richCardHtml), makePayload(poorCardHtml)]);
    expect(dataset.matches).toHaveLength(1);
    expect(dataset.matches[0].sets).toEqual([
      { p1: 11, p2: 7 },
      { p1: 7, p2: 11 },
      { p1: 11, p2: 9 },
      { p1: 11, p2: 4 },
    ]);
    expect(dataset.matches[0].setsResult).toEqual({ p1Sets: 3, p2Sets: 1 });
  });
});
