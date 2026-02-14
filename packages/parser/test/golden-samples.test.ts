import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractDxPayloads, parseDxPayloads } from "../src/index";
import { normalizeText } from "@cbtm/shared";

const fixturesRoot = path.resolve(fileURLToPath(new URL("../../../fixtures/golden", import.meta.url)));
const fixtureFiles = [
  "ABSOLUTO_E_(MAS).txt",
  "MASTER_30FEM.txt",
  "ROM.txt",
].map((name) => path.resolve(fixturesRoot, name));

function discoveredFromPayloads(payloads: ReturnType<typeof extractDxPayloads>) {
  const seeded = parseDxPayloads(5246, payloads).categories;
  const namesById = new Map<string, string>();
  for (const category of seeded) {
    if (category.categoryId) {
      namesById.set(category.categoryId, category.categoryName);
    }
  }

  const categories = new Map<string, { categoryId: string; categoryName: string; valid: boolean }>();
  for (const payload of payloads) {
    if (!payload.categoryId || categories.has(payload.categoryId)) {
      continue;
    }
    categories.set(payload.categoryId, {
      categoryId: payload.categoryId,
      categoryName: namesById.get(payload.categoryId) ?? `Categoria ${payload.categoryId}`,
      valid: payload.categoryId !== "88888888" && payload.categoryId !== "99999999",
    });
  }
  return [...categories.values()];
}

describe("parser golden samples", () => {
  it("suporta os 3 formatos reais sem acoplamento em uma categoria", () => {
    const expectedNames = [
      normalizeText("ABSOLUTO E (MAS)"),
      normalizeText("MASTER 30FEM"),
      normalizeText("ROM"),
    ];

    for (const [index, fixtureFile] of fixtureFiles.entries()) {
      const raw = fs.readFileSync(fixtureFile, "utf8");
      const payloads = extractDxPayloads(raw);
      const dataset = parseDxPayloads(5246, payloads, {
        categoriesDiscovered: discoveredFromPayloads(payloads),
      });

      expect(payloads.length).toBeGreaterThan(0);
      expect(payloads.some((payload) => payload.tab === "INSCRICOES")).toBe(true);
      expect(dataset.registrations.length).toBeGreaterThan(0);
      expect(dataset.categories.length).toBe(1);
      expect(dataset.categories[0].categoryNormalizedName).toBe(expectedNames[index]);
    }
  });

  it("agrega múltiplas categorias e preserva contagens consolidadas", () => {
    const combined = fixtureFiles.map((fixtureFile) => fs.readFileSync(fixtureFile, "utf8")).join("\n\n");
    const payloads = extractDxPayloads(combined);
    const dataset = parseDxPayloads(5246, payloads, {
      categoriesDiscovered: discoveredFromPayloads(payloads),
    });

    expect(dataset.extractionStats.totalCategoriesFound).toBeGreaterThanOrEqual(3);
    expect(dataset.extractionStats.totalCategoriesValid).toBeGreaterThanOrEqual(3);
    expect(dataset.categories.length).toBeGreaterThanOrEqual(3);
    expect(dataset.registrations.length).toBeGreaterThan(40);
    expect(dataset.matches.length).toBeGreaterThan(40);
    expect(Object.keys(dataset.extractionStats.registrationsByCategory).length).toBeGreaterThanOrEqual(3);
  });

  it("resolve categoryId por parameter/keys quando cpCategoriaId não vier no primeiro callback", () => {
    const syntheticRaw = [
      "0|/*DX*/({'id':0,'result':{'data':null,'parameter':'246'}})",
      "0|/*DX*/({'id':0,'result':{'stateObject':{'keys':['246|01  '],'callbackState':'abc','selection':''},'html':'<div id=\"EventoTabPage_Inscricoes\"><div class=\"dxcvBreakpointsCard_MaterialCompact\">ATLETA TESTE<br/>CLUBE TESTE<br/>MASTER 30FEM<br/>Inscrito<br/>10 pts. Ranking<br/>20 pts. Rating</div></div>'}})",
    ].join("\n");

    const payloads = extractDxPayloads(syntheticRaw);
    expect(payloads.length).toBe(1);
    expect(payloads[0].categoryId).toBe("246");
    expect(payloads[0].tab).toBe("INSCRICOES");
  });
});
