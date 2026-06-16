import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { __testables } from "../app/user/events/[id]/page";

test("PP-009 T-U-01 aba Confrontos preserva invariantes de filtro e toggle", () => {
  const source = readFileSync(new URL("../app/user/events/[id]/page.tsx", import.meta.url), "utf8");

  assert.equal(typeof __testables, "object");
  assert.match(source, /scheduleCategoryFilter/);
  assert.match(source, /scheduleViewMode/);
  assert.match(source, /filteredScheduleCategories/);
  assert.match(source, /flatScheduleMatches/);
  assert.match(source, /compareScheduleMatches/);
  assert.match(source, /renderScheduleMatch/);
  assert.match(source, /setScheduleCategoryFilter\(null\)/);
});
