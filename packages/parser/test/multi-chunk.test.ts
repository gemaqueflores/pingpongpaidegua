import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractDxPayloads, parseDxPayloads, parseResultsText } from "../src/index";

describe("parser multi-chunk", () => {
  const fixturePath = path.resolve(fileURLToPath(new URL("../../../fixtures/results.txt", import.meta.url)));
  const fixture = fs.readFileSync(fixturePath, "utf8");

  it("agrega callbacks duplicados sem duplicar inscrições ou jogos", () => {
    const payloads = extractDxPayloads(fixture);
    const firstInscricao = payloads.find((payload) => payload.tab === "INSCRICOES");
    const firstResultado = payloads.find((payload) => payload.tab === "RESULTADOS");

    expect(firstInscricao).toBeTruthy();
    expect(firstResultado).toBeTruthy();

    const syntheticRaw = [
      `0|/*DX*/(${firstInscricao!.rawLiteral})`,
      `0|/*DX*/(${firstInscricao!.rawLiteral})`,
      `0|/*DX*/(${firstResultado!.rawLiteral})`,
      `0|/*DX*/(${firstResultado!.rawLiteral})`,
    ].join("\n\n");

    const dataset = parseResultsText(5246, syntheticRaw);
    const baseline = parseDxPayloads(5246, [firstInscricao!, firstResultado!]);

    expect(dataset.registrations.length).toBe(baseline.registrations.length);
    expect(dataset.matches.length).toBe(baseline.matches.length);
    expect(dataset.extractionStats.tabPayloadCounts.INSCRICOES).toBe(2);
    expect(dataset.extractionStats.tabPayloadCounts.RESULTADOS).toBe(2);
  });

  it("contabiliza categorias encontradas x válidas e ignora ids proibidos", () => {
    const payloads = extractDxPayloads(fixture);
    const firstInscricao = payloads.find((payload) => payload.tab === "INSCRICOES");
    expect(firstInscricao).toBeTruthy();

    const synthetic = parseDxPayloads(5246, [firstInscricao!], {
      categoriesDiscovered: [
        { categoryId: "111", categoryName: "ABSOLUTO E (MAS)", valid: true },
        { categoryId: "88888888", categoryName: "TECNICO", valid: false },
        { categoryId: "99999999", categoryName: "TOTAL", valid: false },
      ],
    });

    expect(synthetic.extractionStats.totalCategoriesFound).toBe(3);
    expect(synthetic.extractionStats.totalCategoriesValid).toBe(1);
    expect(synthetic.categories.some((item) => item.categoryId === "88888888")).toBe(false);
    expect(synthetic.categories.some((item) => item.categoryId === "99999999")).toBe(false);
  });
});
