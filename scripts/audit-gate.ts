import { readFileSync } from 'node:fs';

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

try {
  const status = Number(process.argv[2]);
  if (!Number.isInteger(status) || (status !== 0 && status !== 1)) {
    throw new Error('npm audit terminou com status inesperado');
  }
  const report: unknown = JSON.parse(readFileSync(0, 'utf8'));
  if (!isObject(report) || report.error || report.auditReportVersion !== 2
    || !isObject(report.vulnerabilities) || !isObject(report.metadata)
    || !isObject(report.metadata.vulnerabilities)) {
    throw new Error('resposta nao corresponde ao formato npm audit v2');
  }
  const counts = report.metadata.vulnerabilities;
  const severities = ['info', 'low', 'moderate', 'high', 'critical'];
  if (![...severities, 'total'].every((key) => Number.isSafeInteger(counts[key]) && counts[key] >= 0)
    || severities.reduce((sum, key) => sum + counts[key], 0) !== counts.total) {
    throw new Error('contagens de vulnerabilidades invalidas');
  }
  console.log(`Audit completo: ${JSON.stringify(counts)}`);
  if (counts.critical > 0) {
    console.error(`Audit bloqueado: critical: ${counts.critical}`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`Erro operacional do audit: ${error instanceof Error ? error.message : 'resposta invalida'}`);
  process.exitCode = 1;
}
