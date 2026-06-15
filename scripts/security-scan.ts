import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const scannerRelativePath = path.join('skills', 'security-review-agent', 'scripts', 'security_scan.py');

function candidateScannerPaths(): string[] {
  const candidates = [
    process.env.SECURITY_SCAN_PATH,
    process.env.CODEX_HOME ? path.join(process.env.CODEX_HOME, scannerRelativePath) : null,
    path.join(os.homedir(), '.codex', scannerRelativePath),
  ];

  return candidates.filter((candidate): candidate is string => Boolean(candidate));
}

function findScanner(): string | null {
  return candidateScannerPaths().find((candidate) => existsSync(candidate)) ?? null;
}

function runPython(command: string, scannerPath: string): number | null {
  const args = [scannerPath, ...process.argv.slice(2)];
  // security-scan-ignore: command is fixed to python/python3 and args are passed without shell interpolation.
  const result = spawnSync(command, args, {
    shell: false,
    stdio: 'inherit',
  });

  if (result.error) {
    return null;
  }

  return result.status ?? 1;
}

const scannerPath = findScanner();
if (!scannerPath) {
  console.error('security scanner not found. Set SECURITY_SCAN_PATH or CODEX_HOME, or install the security-review-agent skill under ~/.codex.');
  process.exit(1);
}

const exitCode = runPython('python', scannerPath) ?? runPython('python3', scannerPath);
if (exitCode === null) {
  console.error('python executable not found. Install python or python3 to run verify:security.');
  process.exit(1);
}

process.exit(exitCode);
