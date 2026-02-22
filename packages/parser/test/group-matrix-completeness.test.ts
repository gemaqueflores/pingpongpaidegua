import { describe, expect, it } from "vitest";
import { __testables } from "../src/index";

const resolveHints = () => null;

describe("group matrix completeness", () => {
  it("nao emite warning quando grupos existem sem matriz de confrontos publicada", () => {
    const html = `
      <div class="dxcvBreakpointsCard_MaterialCompact">
        <div>MASTER 35MAS - Grupo 01</div>
        <div>JOAO SILVA</div>
        <div>MARCOS ALMEIDA</div>
        <div>PAULO SOUSA</div>
        <div>LUCAS COSTA</div>
      </div>
    `;

    const result = __testables.parseGroupMatches(5368, html, "CAT-1", resolveHints);
    expect(result.matches.length).toBe(0);
    expect(result.warnings.length).toBe(0);
  });

  it("emite warning de matriz parcial quando confrontos publicados sao menores que o esperado", () => {
    const html = `
      <div class="dxcvBreakpointsCard_MaterialCompact">
        <div>MASTER 35MAS - Grupo 01</div>
        <div>JOAO SILVA</div>
        <div>MARCOS ALMEIDA</div>
        <div>PAULO SOUSA</div>
        <div>LUCAS COSTA</div>
        <div>3 x 0</div>
        <div>2 x 3</div>
      </div>
    `;

    const result = __testables.parseGroupMatches(5368, html, "CAT-1", resolveHints);
    expect(result.matches.length).toBe(2);
    expect(result.warnings.some((warning) => warning.includes("matriz parcial"))).toBe(true);
  });

  it("considera matriz completa quando todos confrontos esperados estao publicados", () => {
    const html = `
      <div class="dxcvBreakpointsCard_MaterialCompact">
        <div>MASTER 35MAS - Grupo 01</div>
        <div>JOAO SILVA</div>
        <div>MARCOS ALMEIDA</div>
        <div>PAULO SOUSA</div>
        <div>LUCAS COSTA</div>
        <div>3 x 0</div>
        <div>2 x 3</div>
        <div>3 x 1</div>
        <div>3 x 2</div>
        <div>0 x 3</div>
        <div>2 x 3</div>
      </div>
    `;

    const result = __testables.parseGroupMatches(5368, html, "CAT-1", resolveHints);
    expect(result.matches.length).toBe(6);
    expect(result.warnings.length).toBe(0);
  });

  it("ignora sentinela de grupos indisponiveis sem gerar warning", () => {
    const html = `
      <div class="dxcvBreakpointsCard_MaterialCompact">
        <div>Os grupos não estão disponíveis!</div>
      </div>
    `;

    const result = __testables.parseGroupMatches(5368, html, "CAT-1", resolveHints);
    expect(result.matches.length).toBe(0);
    expect(result.warnings.length).toBe(0);
  });
});
