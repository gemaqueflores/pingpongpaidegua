import assert from "node:assert/strict";
import test from "node:test";
import { buildReadModelCacheCleanupWhere } from "../src/pipeline/scrape.processor";

test("T-I-03 stage-1-reset invalida espelho do evento", () => {
  assert.deepEqual(buildReadModelCacheCleanupWhere(5691), { eventId: 5691 });
});
