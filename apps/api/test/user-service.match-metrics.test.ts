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

test("PP-016 T-U-02 calibra partidas previstas para publicado maior que teorico", () => {
  const metrics = computeCategoryMatchMetrics({
    calculatedMatchesCount: 6,
    publishedMatchesCount: 9,
    walkoverMatchesCount: 2,
  });

  assert.equal(metrics.calculatedMatchesCount, 9);
  assert.equal(metrics.playedMatchesCount, 7);
});

test("PP-016 T-U-03 mantem fallback teorico quando nao ha partidas publicadas", () => {
  const metrics = computeCategoryMatchMetrics({
    calculatedMatchesCount: 6,
    publishedMatchesCount: 0,
    walkoverMatchesCount: 0,
  });

  assert.equal(metrics.calculatedMatchesCount, 6);
});
