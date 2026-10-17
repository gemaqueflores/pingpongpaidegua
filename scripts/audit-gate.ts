import { readFileSync } from 'node:fs';

const report = JSON.parse(readFileSync(0, 'utf8'));
const critical = report.metadata.vulnerabilities.critical;
console.error(`critical: ${critical}`);
process.exitCode = 1;
