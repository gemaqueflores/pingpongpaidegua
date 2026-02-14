import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractDxPayloads, parseDxPayloads, parseResultsText } from "../src/index";

const fixturePath = path.resolve(
  fileURLToPath(new URL("../../../fixtures/golden/MASTER_30MAS.txt", import.meta.url)),
);

function buildSyntheticResultadosPayload(cardHtml: string): string {
  const escapedHtml = `<div id="EventoTabPage_Resultados">${cardHtml}</div>`
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\r?\n/g, "\\n");
  return `0|/*DX*/({'id':0,'cp':{'cpCategoriaId':'256'},'result':{'stateObject':{'keys':['1973114'],'callbackState':'abc','selection':''},'html':'${escapedHtml}'}})`;
}

describe("parser resultados master 30mas", () => {
  it("extrai placar final e sets completos da fixture real do DevTools", () => {
    const raw = fs.readFileSync(fixturePath, "utf8");
    const payloads = extractDxPayloads(raw);
    const dataset = parseDxPayloads(5246, payloads);
    const finalMatch = dataset.matches.find(
      (match) =>
        match.round === "Final" &&
        match.athleteANormalizedName === "gabriel cabral" &&
        match.athleteBNormalizedName === "tiago holanda",
    );

    expect(finalMatch).toBeDefined();
    expect(finalMatch?.setsResult).toEqual({ p1Sets: 3, p2Sets: 0 });
    expect(finalMatch?.sets).toEqual([
      { p1: 11, p2: 9 },
      { p1: 11, p2: 9 },
      { p1: 13, p2: 11 },
    ]);
  });

  it("normaliza entidades HTML e nao cria sets fantasmas com &nbsp;", () => {
    const cardHtml = `
<div class="dxcvBreakpointsCard_MaterialCompact">
  SUB13 MAS - Grupo 01
  3-0
  Jogo 001 - Mesa 4 - 10:30
  29/11/2025
  <table>
    <tr><td>Z&#201;LIS NETO</td><td>3</td><td>11</td><td>11</td><td>11</td><td>&nbsp;</td><td>&nbsp;</td></tr>
    <tr><td>LUCAS MENEZES</td><td>0</td><td>7</td><td>9</td><td>5</td><td>&nbsp;</td><td>&nbsp;</td></tr>
  </table>
</div>`;
    const dataset = parseResultsText(5246, buildSyntheticResultadosPayload(cardHtml));
    const match = dataset.matches[0];

    expect(match.athleteAName).toBe("ZÉLIS NETO");
    expect(match.athleteBName).toBe("LUCAS MENEZES");
    expect(match.setsResult).toEqual({ p1Sets: 3, p2Sets: 0 });
    expect(match.sets).toEqual([
      { p1: 11, p2: 7 },
      { p1: 11, p2: 9 },
      { p1: 11, p2: 5 },
    ]);
  });

  it("mantem fallback quando jogo concluido chega sem pontos por set", () => {
    const cardHtml = `
<div class="dxcvBreakpointsCard_MaterialCompact">
  SUB13 MAS - Semifinal
  3-0
  Jogo 010 - Mesa 2 - 13:50
  29/11/2025
  <table>
    <tr><td>LUCAS MENEZES</td><td>3</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
    <tr><td>ATLETA B</td><td>0</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
  </table>
</div>`;
    const dataset = parseResultsText(5246, buildSyntheticResultadosPayload(cardHtml));
    const match = dataset.matches[0];

    expect(match.scoreRaw).toBe("3-0");
    expect(match.setsResult).toEqual({ p1Sets: 3, p2Sets: 0 });
    expect(match.sets).toEqual([]);
  });
});
