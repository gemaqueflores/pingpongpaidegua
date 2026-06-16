import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const mainSourcePath = path.resolve(currentDir, "../src/main.ts");

test("T-U-01 scrape-event agendado define removeOnFail com retencao minima de 30 dias", () => {
  const source = fs.readFileSync(mainSourcePath, "utf8");

  assert.match(source, /queue\.add\(\s*"scrape-event"[\s\S]*?removeOnFail\s*:/);
  assert.match(source, /age:\s*config\.failedQueueRetentionDays\s*\*\s*86400/);
  assert.match(source, /count:\s*200/);
});
