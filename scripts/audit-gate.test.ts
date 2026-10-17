import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

function gate(input: string, auditStatus = 1) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'scripts/audit-gate.ts', String(auditStatus)], {
    input, encoding: 'utf8',
  });
}

function fixture(critical: number, high = 0, moderate = 0, low = 0) {
  return JSON.stringify({ auditReportVersion: 2, vulnerabilities: {}, metadata: {
    vulnerabilities: { info: 0, low, moderate, high, critical, total: critical + high + moderate + low },
  } });
}

test('T-U-05: rejects a critical vulnerability with an actionable message', () => {
  const result = gate(fixture(1));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /critical: 1/);
});
