// Executar com frontend local; PP037_WEB_URL pode apontar para a stack Docker.
// Dados sinteticos de teste, calculados pelo UserService real; sem banco/producao.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { rankingFor, careerFor } from "./fixtures/pp037-modalities";

async function main() {
  const webUrl = process.env.PP037_WEB_URL ?? "http://localhost:3001";
  const evidence = "tmp/pp037-visual";
  await mkdir(evidence, { recursive: true });
  const ranking = await rankingFor(["RATING A", "DUPLA MISTA SUB-13"]);
  const career = await careerFor("DUPLA MISTA SUB-13");
  assert.equal(ranking.ranking[0].totalPontuacao, 390);
  assert.equal(career.medalTable.ESTADUAL.prata, 1);
  await writeFile(`${evidence}/payloads.json`, JSON.stringify({ ranking, career }, null, 2));

  const browser = await chromium.launch({ headless: true });
  const observations: unknown[] = [];
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/*", async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (!["fetch", "xhr"].includes(route.request().resourceType()) ||
            route.request().headers()["rsc"] === "1") {
          await route.continue();
          return;
        }
        const body = path.endsWith("/career") ? career
          : path.endsWith("/efficiency") ? { ...ranking, availableYears: [2026] } : [];
        await route.fulfill({ json: body, headers: { "access-control-allow-origin": webUrl } });
      });
      await page.goto(`${webUrl}/eficiencia`);
      await page.getByRole("heading", { name: "CLUBE TESTE", exact: true }).waitFor();
      assert.equal(await page.locator(".efficiency-club-total strong").innerText(), "390");
      assert.match(await page.locator(".athlete-list-card").innerText(), /🥇1 🥈0 🥉0 \(1\)/);
      await page.screenshot({ path: `${evidence}/ranking-${viewport.width}.png`, fullPage: true });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

      // Alias client-side: evita fetch de metadata no servidor da rota canonica.
      await page.goto(`${webUrl}/user/career/alice`);
      await page.getByRole("heading", { name: "ALICE", exact: true }).waitFor();
      await page.getByRole("button", { name: "Tudo", exact: true }).click();
      const silver = page.locator(".career-medal-bar-row").filter({ hasText: "Prata" });
      assert.equal(await silver.locator("strong").innerText(), "1");
      assert.match(await page.locator(".athlete-summary-card").innerText(), /32\/74 pontos/);
      assert.match(await page.locator(".athlete-summary-card").innerText(), /Total de confrontos: 1/);
      // content-visibility:auto adia a pintura fora da viewport: capturar cada secao visivel.
      await page.locator(".athlete-summary-card").screenshot({ path: `${evidence}/career-${viewport.width}.png` });
      await page.locator(".career-event-matches").scrollIntoViewIfNeeded();
      await page.locator("#eventos").screenshot({ path: `${evidence}/career-events-${viewport.width}.png` });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.deepEqual(errors, []);
      observations.push({ viewport, ranking: "1 ouro / 390 pontos", career: "1 prata / 32 de 74 pontos", errors });
      await page.close();
    }
    await writeFile(`${evidence}/result.json`, JSON.stringify(observations, null, 2));
    console.log(JSON.stringify(observations, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
