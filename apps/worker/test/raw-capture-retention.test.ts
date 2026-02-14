import assert from "node:assert/strict";
import test from "node:test";
import { shouldRetainRun, toCutoff } from "../src/pipeline/raw-capture-retention.service";

test("toCutoff retorna null para dias invalidos", () => {
  assert.equal(toCutoff(0), null);
  assert.equal(toCutoff(-10), null);
  assert.equal(toCutoff(Number.NaN), null);
});

test("retencao sempre preserva runs recentes de sucesso e maxRuns", () => {
  const now = new Date("2026-02-14T12:00:00.000Z");
  const successCutoff = new Date("2026-02-01T00:00:00.000Z");

  const keepByMaxRuns = shouldRetainRun({
    runIndex: 0,
    status: "SUCCESS",
    startedAt: new Date("2026-01-01T00:00:00.000Z"),
    successCutoff,
    errorCutoff: null,
    maxRunsPerEvent: 2,
  });
  assert.equal(keepByMaxRuns, true);

  const keepByRecentSuccess = shouldRetainRun({
    runIndex: 10,
    status: "SUCCESS",
    startedAt: new Date("2026-02-10T00:00:00.000Z"),
    successCutoff,
    errorCutoff: null,
    maxRunsPerEvent: 2,
  });
  assert.equal(keepByRecentSuccess, true);

  const pruneOldSuccess = shouldRetainRun({
    runIndex: 10,
    status: "SUCCESS",
    startedAt: new Date("2026-01-01T00:00:00.000Z"),
    successCutoff,
    errorCutoff: null,
    maxRunsPerEvent: 2,
  });
  assert.equal(pruneOldSuccess, false);

  assert.ok(now instanceof Date);
});

test("retencao de runs ERROR/PARTIAL respeita cutoff opcional", () => {
  const errorCutoff = new Date("2026-01-20T00:00:00.000Z");

  const keepWithoutCutoff = shouldRetainRun({
    runIndex: 100,
    status: "ERROR",
    startedAt: new Date("2025-01-01T00:00:00.000Z"),
    successCutoff: null,
    errorCutoff: null,
    maxRunsPerEvent: 1,
  });
  assert.equal(keepWithoutCutoff, true);

  const keepRecentError = shouldRetainRun({
    runIndex: 100,
    status: "PARTIAL",
    startedAt: new Date("2026-02-01T00:00:00.000Z"),
    successCutoff: null,
    errorCutoff,
    maxRunsPerEvent: 1,
  });
  assert.equal(keepRecentError, true);

  const pruneOldError = shouldRetainRun({
    runIndex: 100,
    status: "ERROR",
    startedAt: new Date("2026-01-01T00:00:00.000Z"),
    successCutoff: null,
    errorCutoff,
    maxRunsPerEvent: 1,
  });
  assert.equal(pruneOldError, false);
});

