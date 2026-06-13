import { describe, expect, it } from "vitest";
import { parseResultsText } from "../src/index";

function buildSyntheticPayload(tab: "Resultados" | "Grupos", cardHtml: string): string {
  const tabId = tab === "Resultados" ? "EventoTabPage_Resultados" : "EventoTabPage_Grupos";
  const escapedHtml = `<div id="${tabId}">${cardHtml}</div>`
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\r?\n/g, "\\n");

  return `0|/*DX*/({'id':0,'cp':{'cpCategoriaId':'999'},'result':{'stateObject':{'keys':['1'],'callbackState':'abc','selection':''},'html':'${escapedHtml}'}})`;
}

describe("parser de jogos de duplas", () => {
  it("T-U-01 agrupa jogadores por lado em tabela de placar com quatro linhas", () => {
    const cardHtml = `
<div class="dxcvBreakpointsCard_MaterialCompact">
  DUPLA MISTA - SUB-15 - Final
  2-0
  Jogo 001 - Mesa 1 - 14:00
  13/06/2026
  <table>
    <tr><td>KAYLANNE DEUS</td><td>2</td><td>11</td><td>11</td></tr>
    <tr><td>MARIANNY MORAES</td><td></td><td></td><td></td></tr>
    <tr><td>DEBORA FLORES</td><td>0</td><td>5</td><td>7</td></tr>
    <tr><td>REBECA FLORES</td><td></td><td></td><td></td></tr>
  </table>
</div>`;

    const dataset = parseResultsText(5691, buildSyntheticPayload("Resultados", cardHtml));
    const match = dataset.matches[0];

    expect(match.athleteAName).toBe("KAYLANNE DEUS # MARIANNY MORAES");
    expect(match.athleteBName).toBe("DEBORA FLORES # REBECA FLORES");
    expect(match.setsResult).toEqual({ p1Sets: 2, p2Sets: 0 });
    expect(match.sets).toEqual([
      { p1: 11, p2: 5 },
      { p1: 11, p2: 7 },
    ]);
  });
});
