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

test('T-U-06: allows high, moderate, low and a clean audit', () => {
  assert.equal(gate(fixture(0, 4, 2, 1)).status, 0);
  assert.equal(gate(fixture(0), 0).status, 0);
});

test('T-U-07: fails closed for operational errors and invalid reports', () => {
  const invalid = [
    '', '{broken', '{}', 'null',
    JSON.stringify({ error: { code: 'ENETUNREACH' } }),
    JSON.stringify({ metadata: { vulnerabilities: { critical: 0 } } }),
    fixture(0).replace('"critical":0', '"critical":-1'),
    fixture(0).replace('"critical":0', '"critical":"0"'),
    fixture(0).replace('"total":0', '"total":1'),
    fixture(0).replace('"auditReportVersion":2', '"auditReportVersion":1'),
    fixture(0).replace('"vulnerabilities":{}', '"vulnerabilities":[]'),
    fixture(0).replace('"auditReportVersion":2', '"error":{"code":"E500"},"auditReportVersion":2'),
  ];
  for (const input of invalid) {
    const result = gate(input);
    assert.equal(result.status, 1, input);
    assert.match(result.stderr, /operacional/, input);
  }
  assert.equal(gate(fixture(0), 2).status, 1);
  assert.equal(gate(fixture(0), 127).status, 1);
});
