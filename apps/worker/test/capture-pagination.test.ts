import assert from "node:assert/strict";
import test from "node:test";
import { CaptureService } from "../src/scraper/capture.service";

test("T-U-04 paginateCardView retorna warning quando controle DX esta indisponivel", async () => {
  const service = new CaptureService() as unknown as {
    paginateCardView(
      page: {
        evaluate<T>(callback: (input: string) => T, input: string): Promise<T>;
        waitForLoadState(): Promise<void>;
        waitForTimeout(): Promise<void>;
      },
      controlVar: string,
      context?: { categoryId: string; tabLabel: string },
    ): Promise<{ requests: number; warnings: string[] }>;
  };
  const previousWindow = (globalThis as typeof globalThis & { window?: unknown }).window;
  (globalThis as typeof globalThis & { window?: unknown }).window = {};

  try {
    const result = await service.paginateCardView(
      {
        evaluate: async (callback, input) => callback(input),
        waitForLoadState: async () => undefined,
        waitForTimeout: async () => undefined,
      },
      "CardViewResultado",
      { categoryId: "123", tabLabel: "RESULTADOS" },
    );

    assert.deepEqual(result, {
      requests: 0,
      warnings: [
        "Controle de paginacao indisponivel - categoria registrada sem dados de paginacao (categoria=123, aba=RESULTADOS).",
      ],
    });
  } finally {
    (globalThis as typeof globalThis & { window?: unknown }).window = previousWindow;
  }
});
