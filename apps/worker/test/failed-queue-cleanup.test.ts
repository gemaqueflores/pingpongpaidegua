import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { classifyFailedReasons } from "../src/main";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const mainSourcePath = path.resolve(currentDir, "../src/main.ts");

test("T-U-01 scrape-event agendado define removeOnFail com retencao minima de 30 dias", () => {
  const source = fs.readFileSync(mainSourcePath, "utf8");

  assert.match(source, /queue\.add\(\s*"scrape-event"[\s\S]*?removeOnFail\s*:/);
  assert.match(source, /age:\s*config\.failedQueueRetentionDays\s*\*\s*86400/);
  assert.match(source, /count:\s*200/);
});

test("T-U-02 classifica failedReason por padroes operacionais conhecidos", () => {
  assert.deepEqual(
    classifyFailedReasons([
      "TypeError: Cannot read properties of null (reading 'GetItemsRangeForLoad')",
      "Error: browser fallback falhou ao abrir pagina",
      "browserContext.close: Target page, context or browser has been closed",
      "Falha desconhecida",
    ]),
    {
      GetItemsRangeForLoad: 1,
      browser_fallback: 1,
      browser_context_closed: 1,
      other: 1,
    },
  );
});
