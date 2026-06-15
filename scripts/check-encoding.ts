import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const textExtensions = new Set([
  '.css',
  '.html',
  '.js',
  '.jsx',
  '.json',
  '.md',
  '.prisma',
  '.sql',
  '.ts',
  '.tsx',
  '.txt',
  '.yml',
  '.yaml',
]);

const mojibakePatterns = [
  '\u00c3\u00a3',
  '\u00c3\u00a1',
  '\u00c3\u00a9',
  '\u00c3\u00aa',
  '\u00c3\u00ad',
  '\u00c3\u00b3',
  '\u00c3\u00b5',
  '\u00c3\u00a7',
  '\u00c3\u00ba',
  '\u00c3\u0192',
  '\u00c2\u00b0',
  '\u00c2',
  '\ufffd',
];

function tokenPattern(prefix: string): RegExp {
  return new RegExp(`${prefix}[A-Za-z0-9_=-]+`, 'g');
}

const secretPatterns = [
  tokenPattern('g' + 'hp_'),
  tokenPattern('sk-' + 'proj-'),
  tokenPattern('sk-' + 'ant-'),
  tokenPattern('AI' + 'za'),
  tokenPattern('\\$' + 'aa' + 'ct_'),
];

function runGit(args: string[]): string[] {
  try {
    const output = execFileSync('git', args, { encoding: 'utf8' });
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function changedFiles(): string[] {
  return Array.from(
    new Set([
      ...runGit(['diff', '--name-only', '--diff-filter=ACMRTUXB', 'HEAD']),
      ...runGit(['diff', '--name-only', '--cached', '--diff-filter=ACMRTUXB', 'HEAD']),
      ...runGit(['ls-files', '--others', '--exclude-standard']),
    ]),
  );
}

function allTrackedFiles(): string[] {
  return runGit(['ls-files']);
}

function isTextFile(file: string): boolean {
  return textExtensions.has(path.extname(file).toLowerCase());
}

const scanAll = process.argv.includes('--all');
const strictLinebreaks = process.argv.includes('--strict-linebreaks');
const explicitFiles = process.argv.filter((arg) => !arg.startsWith('--')).slice(2);
const files = explicitFiles.length > 0 ? explicitFiles : scanAll ? allTrackedFiles() : changedFiles();

const findings: string[] = [];

for (const file of files) {
  if (!isTextFile(file) || !existsSync(file) || !statSync(file).isFile()) {
    continue;
  }

  const raw = readFileSync(file);
  const content = raw.toString('utf8');

  if (raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) {
    findings.push(`${file}: UTF-8 BOM detected`);
  }

  if (strictLinebreaks && content.includes('\r\n')) {
    findings.push(`${file}: CRLF detected`);
  }

  const mojibakeHits = mojibakePatterns.filter((pattern) => content.includes(pattern));
  if (mojibakeHits.length > 0) {
    findings.push(`${file}: mojibake-like text ${mojibakeHits.join(', ')}`);
  }

  for (const pattern of secretPatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(content)) {
      findings.push(`${file}: secret-like token detected (${pattern.source})`);
    }
  }
}

if (findings.length > 0) {
  console.error(findings.join('\n'));
  process.exit(1);
}

console.log(`encoding ok (${files.length} candidate files)`);
