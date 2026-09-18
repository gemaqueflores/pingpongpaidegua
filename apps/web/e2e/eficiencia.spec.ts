import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";

// T-E-01 — PP-050
// Primeira suite Playwright do projeto. Usa a lib base `playwright` (chromium.launch), ja instalada via
// apps/worker (scraping), em vez de `@playwright/test` — esse pacote nao esta instalado no monorepo e
// adiciona-lo violaria "Dependencias novas: nenhuma" (Q7) sem aprovacao explicita de Leo. Desvio tecnico
// declarado no relatorio de entrega.
//
// Verifica o efeito real: nenhum erro de CSP no console e pelo menos um clube real renderizado no DOM —
// nao apenas HTTP 200 (a pagina podia retornar 200 e mostrar "Servico indisponivel" client-side).

const TARGET_URL = process.env.PP050_E2E_URL ?? "http://localhost:3000/eficiencia";
const EXPECTED_CLUB_SUBSTRING = process.env.PP050_E2E_EXPECTED_CLUB ?? "PARÁ CLUBE";

test("T-E-01 — /eficiencia carrega sem erro de CSP e exibe clube real", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const consoleErrors: string[] = [];
    const cspErrors: string[] = [];

    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });
    page.on("requestfailed", (request) => {
      const failure = request.failure();
      if (failure?.errorText) {
        cspErrors.push(`${request.url()} — ${failure.errorText}`);
      }
    });

    await page.goto(TARGET_URL, { waitUntil: "networkidle" });

    // Aguarda o carregamento sair do estado de skeleton/loading para o conteudo real ou o empty state.
    await page.waitForFunction(
      () => !document.querySelector(".athlete-list-grid .skeleton, [class*='Skeleton']"),
      { timeout: 15000 },
    ).catch(() => {
      // se o seletor de skeleton nao existir no DOM renderizado, segue — o teste valida pelo conteudo abaixo
    });

    const bodyText = await page.textContent("body");

    const cspRelatedErrors = consoleErrors.filter((text) =>
      /content security policy|refused to connect|csp/i.test(text),
    );
    assert.deepEqual(
      cspRelatedErrors,
      [],
      `erro de CSP encontrado no console: ${JSON.stringify(cspRelatedErrors)}`,
    );
    assert.deepEqual(
      cspErrors,
      [],
      `requisicao falhou (possivel bloqueio de CSP): ${JSON.stringify(cspErrors)}`,
    );

    assert.ok(
      bodyText && !bodyText.includes("Serviço indisponível"),
      "página exibiu \"Serviço indisponível\" — fetch client-side falhou",
    );
    assert.ok(
      bodyText && bodyText.toUpperCase().includes(EXPECTED_CLUB_SUBSTRING.toUpperCase()),
      `clube esperado "${EXPECTED_CLUB_SUBSTRING}" não encontrado no DOM renderizado`,
    );
  } finally {
    await browser.close();
  }
});
