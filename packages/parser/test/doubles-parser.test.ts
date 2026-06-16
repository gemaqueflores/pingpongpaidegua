import { describe, expect, it } from "vitest";
import { __testables, parseResultsText } from "../src/index";

const resolveHints = () => null;

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

  it("T-U-02 agrupa nomes filtrados no fallback de card textual de duplas", () => {
    const cardHtml = `
<div class="dxcvBreakpointsCard_MaterialCompact">
  DUPLA MISTA - SUB-15 - Semifinal
  Jogo 001 - Mesa 1 - 14:00
  13/06/2026
  CLAYTON FILHO
  ESTER YOSHIDA
  ANA PEREIRA
  MISAEL TAVARES
</div>`;

    const dataset = parseResultsText(5691, buildSyntheticPayload("Resultados", cardHtml));
    const match = dataset.matches[0];

    expect(match.athleteAName).toBe("CLAYTON FILHO # ESTER YOSHIDA");
    expect(match.athleteBName).toBe("ANA PEREIRA # MISAEL TAVARES");
  });

  it("T-U-03 preserva nomes individuais em card sem indicador de dupla", () => {
    const cardHtml = `
<div class="dxcvBreakpointsCard_MaterialCompact">
  ABSOLUTO MAS - Final
  3-1
  Jogo 001 - Mesa 1 - 14:00
  13/06/2026
  <table>
    <tr><td>ATLETA UM</td><td>3</td><td>11</td><td>9</td><td>11</td><td>11</td></tr>
    <tr><td>ATLETA DOIS</td><td>1</td><td>7</td><td>11</td><td>6</td><td>8</td></tr>
  </table>
</div>`;

    const dataset = parseResultsText(5680, buildSyntheticPayload("Resultados", cardHtml));
    const match = dataset.matches[0];

    expect(match.athleteAName).toBe("ATLETA UM");
    expect(match.athleteBName).toBe("ATLETA DOIS");
    expect(match.athleteAName).not.toContain("#");
    expect(match.athleteBName).not.toContain("#");
  });

  it("T-U-04 gera confrontos entre duplas em matriz de grupo de duplas", () => {
    const html = `
<div class="dxcvBreakpointsCard_MaterialCompact">
  <div>DUPLA MISTA - SUB-15 FEM - Grupo 01</div>
  <div>ANA PEREIRA</div>
  <div>MISAEL TAVARES</div>
  <div>CLAYTON FILHO</div>
  <div>ESTER YOSHIDA</div>
  <div>DEBORA FLORES</div>
  <div>REBECA FLORES</div>
  <div>2 x 0</div>
  <div>2 x 1</div>
  <div>0 x 2</div>
</div>`;

    const result = __testables.parseGroupMatches(5691, html, "999", resolveHints);

    expect(result.matches).toHaveLength(3);
    expect(result.matches.every((match) => match.athleteAName.includes("#"))).toBe(true);
    expect(result.matches.every((match) => match.athleteBName.includes("#"))).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it("T-U-05 preserva matriz individual com quatro atletas", () => {
    const html = `
<div class="dxcvBreakpointsCard_MaterialCompact">
  <div>ABSOLUTO MAS - Grupo 01</div>
  <div>ATLETA UM</div>
  <div>ATLETA DOIS</div>
  <div>ATLETA TRES</div>
  <div>ATLETA QUATRO</div>
  <div>3 x 0</div>
  <div>3 x 1</div>
  <div>3 x 2</div>
  <div>0 x 3</div>
  <div>1 x 3</div>
  <div>2 x 3</div>
</div>`;

    const result = __testables.parseGroupMatches(5680, html, "999", resolveHints);

    expect(result.matches).toHaveLength(6);
    expect(result.matches.some((match) => match.athleteAName.includes("#") || match.athleteBName.includes("#"))).toBe(
      false,
    );
    expect(result.warnings).toHaveLength(0);
  });

  it("T-U-06 trata tabela de duplas com tres linhas sem trocar o lado B pelo parceiro do lado A", () => {
    const cardHtml = `
<div class="dxcvBreakpointsCard_MaterialCompact">
  DUPLA MISTA - SUB-15 - Final
  2-0
  Jogo 001 - Mesa 1 - 14:00
  13/06/2026
  <table>
    <tr><td>ATLETA A</td><td>2</td><td>11</td><td>11</td></tr>
    <tr><td>PARCEIRO A</td><td></td><td></td><td></td></tr>
    <tr><td>ATLETA B</td><td>0</td><td>6</td><td>8</td></tr>
  </table>
</div>`;

    const dataset = parseResultsText(5691, buildSyntheticPayload("Resultados", cardHtml));
    const match = dataset.matches[0];

    expect(match.athleteAName).toBe("ATLETA A # PARCEIRO A");
    expect(match.athleteBName).toBe("ATLETA B");
    expect(match.setsResult).toEqual({ p1Sets: 2, p2Sets: 0 });
    expect(match.sets).toEqual([
      { p1: 11, p2: 6 },
      { p1: 11, p2: 8 },
    ]);
  });

  it("T-U-07 gera todos os confrontos em grupo com cinco duplas", () => {
    const html = `
<div class="dxcvBreakpointsCard_MaterialCompact">
  <div>DUPLA MISTA - SUB-15 FEM - Grupo 02</div>
  <div>ANA PEREIRA</div>
  <div>MISAEL TAVARES</div>
  <div>CLAYTON FILHO</div>
  <div>ESTER YOSHIDA</div>
  <div>DEBORA FLORES</div>
  <div>REBECA FLORES</div>
  <div>KAYLANNE DEUS</div>
  <div>MARIANNY MORAES</div>
  <div>LUCAS SOUZA</div>
  <div>MATEUS LIMA</div>
  <div>2 x 0</div>
  <div>2 x 1</div>
  <div>0 x 2</div>
  <div>2 x 0</div>
  <div>1 x 2</div>
  <div>2 x 1</div>
  <div>0 x 2</div>
  <div>2 x 0</div>
  <div>2 x 1</div>
  <div>0 x 2</div>
</div>`;

    const result = __testables.parseGroupMatches(5691, html, "999", resolveHints);

    expect(result.matches).toHaveLength(10);
    expect(result.matches.every((match) => match.athleteAName.includes("#"))).toBe(true);
    expect(result.matches.every((match) => match.athleteBName.includes("#"))).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });
});
