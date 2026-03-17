import assert from "node:assert/strict";
import test from "node:test";
import { HealthMonitorService } from "../src/common/health-monitor.service";

function createService() {
  return new HealthMonitorService({} as never, {} as never, {} as never) as unknown as {
    shouldRecoverRun(input: {
      status: "SUCCESS" | "PARTIAL" | "ERROR";
      warnings: string[];
      extractionStats: unknown;
    }): boolean;
  };
}

test("health monitor aciona recovery por warning operacional persistido", () => {
  const service = createService();

  const shouldRecover = service.shouldRecoverRun({
    status: "PARTIAL",
    warnings: ["AUDITORIA_PARTIDAS_DIVERGENCIA: 2 categoria(s) com divergencia de partidas."],
    extractionStats: {},
  });

  assert.equal(shouldRecover, true);
});

test("health monitor ignora warning diagnostico ruidoso sem auditoria", () => {
  const service = createService();

  const shouldRecover = service.shouldRecoverRun({
    status: "PARTIAL",
    warnings: ["RESULTADOS diagnostico 'RHM' (1050): com_sets=6, sem_sets=0."],
    extractionStats: {},
  });

  assert.equal(shouldRecover, false);
});

test("health monitor continua acionando recovery por extractionStats quando warnings foram filtrados", () => {
  const service = createService();

  const shouldRecover = service.shouldRecoverRun({
    status: "PARTIAL",
    warnings: [],
    extractionStats: {
      conformanceAudit: {
        matchMismatches: 1,
        registrationMismatches: 0,
        pendingConflicts: 0,
      },
    },
  });

  assert.equal(shouldRecover, true);
});
