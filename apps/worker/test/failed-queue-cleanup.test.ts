import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { classifyFailedReasons, cleanupFailedQueue } from "../src/main";

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

test("T-U-03 cleanup remove apenas jobs failed mais antigos que a retencao", async () => {
  const removedJobIds: string[] = [];
  const now = Date.UTC(2026, 5, 16, 12, 0, 0);
  const oldJob = {
    id: "old",
    timestamp: now - 31 * 86400 * 1000,
    failedReason: "GetItemsRangeForLoad",
    remove: async () => {
      removedJobIds.push("old");
    },
  };
  const recentJob = {
    id: "recent",
    timestamp: now - 2 * 86400 * 1000,
    failedReason: "browser fallback",
    remove: async () => {
      removedJobIds.push("recent");
    },
  };
  const queue = {
    getFailed: async (start: number, end: number) => {
      assert.equal(start, 0);
      assert.equal(end, 500);
      return [oldJob, recentJob];
    },
  };

  const result = await cleanupFailedQueue(queue, { now, retentionDays: 30 });

  assert.deepEqual(removedJobIds, ["old"]);
  assert.equal(result.total, 2);
  assert.equal(result.removidos, 1);
  assert.deepEqual(result.porPadrao, {
    GetItemsRangeForLoad: 1,
    browser_fallback: 1,
    browser_context_closed: 0,
    other: 0,
  });
});
