import assert from "node:assert/strict";
import test from "node:test";
import { computeCategoryMatchMetrics } from "../src/user/user.service";

test("PP-016 T-U-01 mantem partidas previstas quando teorico supera publicado", () => {
  const metrics = computeCategoryMatchMetrics({
    calculatedMatchesCount: 6,
    publishedMatchesCount: 5,
    walkoverMatchesCount: 1,
  });

  assert.equal(metrics.calculatedMatchesCount, 6);
});
