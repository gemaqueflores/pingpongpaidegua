import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("PP-025 T-U-08 admin carrega, exibe e envia competitionFormat", () => {
  const pageSource = readFileSync(new URL("../app/admin/page.tsx", import.meta.url), "utf8");
  const apiSource = readFileSync(new URL("../lib/admin-api.ts", import.meta.url), "utf8");

  assert.match(apiSource, /export type CompetitionFormat = "AUTO" \| "K1"/);
  assert.match(apiSource, /competitionFormat\?: CompetitionFormat/);
  assert.match(apiSource, /competitionFormat: CompetitionFormat/);
  assert.match(pageSource, /setCompetitionFormat\(event\.competitionFormat \?\? "AUTO"\)/);
  assert.match(pageSource, /value=\{competitionFormat\}/);
  assert.match(pageSource, /competitionFormat,\s*seedCriteria/);
  assert.match(pageSource, /Formato da competi[cç][aã]o/);
});
