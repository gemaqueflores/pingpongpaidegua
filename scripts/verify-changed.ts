import { execFileSync, spawnSync } from 'node:child_process';

type Command = {
  key: string;
  command: string;
};

function runGit(args: string[]): string[] {
  try {
    return execFileSync('git', args, { encoding: 'utf8' })
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

function add(commands: Map<string, Command>, key: string, command: string): void {
  commands.set(key, { key, command });
}

function matchesAny(file: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => file === prefix || file.startsWith(`${prefix}/`));
}

const files = changedFiles();
const commands = new Map<string, Command>();

add(commands, 'encoding', 'npm run verify:encoding');
add(commands, 'security', 'npm run verify:security');

if (files.length === 0) {
  console.log('No changed files detected. Running encoding check only.');
}

const rootConfigChanged = files.some((file) =>
  ['package.json', 'package-lock.json', 'tsconfig.base.json', 'docker-compose.yml'].includes(file),
);
const prismaChanged = files.some((file) => matchesAny(file, ['prisma']));
const parserChanged = files.some((file) => matchesAny(file, ['packages/parser', 'fixtures']));
const sharedChanged = files.some((file) => matchesAny(file, ['packages/shared']));
const apiChanged = files.some((file) => matchesAny(file, ['apps/api']));
const workerChanged = files.some((file) => matchesAny(file, ['apps/worker']));
const webChanged = files.some((file) => matchesAny(file, ['apps/web']));
const domainCriticalChanged = parserChanged || sharedChanged || workerChanged;

if (rootConfigChanged) {
  add(commands, 'test-all', 'npm run test');
  add(commands, 'build-all', 'npm run build');
} else {
  if (prismaChanged) {
    add(commands, 'prisma-generate', 'npm run prisma:generate');
    add(commands, 'api-build', 'npm run build --workspace apps-api');
    add(commands, 'worker-build', 'npm run build --workspace apps-worker');
  }

  if (sharedChanged) {
    add(commands, 'shared-test', 'npm run test --workspace @cbtm/shared');
    add(commands, 'shared-build', 'npm run build --workspace @cbtm/shared');
  }

  if (parserChanged) {
    add(commands, 'parser-test', 'npm run test --workspace @cbtm/parser');
    add(commands, 'parser-build', 'npm run build --workspace @cbtm/parser');
  }

  if (apiChanged) {
    add(commands, 'api-test', 'npm run test --workspace apps-api');
    add(commands, 'api-build', 'npm run build --workspace apps-api');
  }

  if (workerChanged) {
    add(commands, 'worker-test', 'npm run test --workspace apps-worker');
    add(commands, 'worker-build', 'npm run build --workspace apps-worker');
  }

  if (webChanged) {
    add(commands, 'web-test', 'npm run test --workspace apps-web');
    add(commands, 'web-build', 'npm run build --workspace apps-web');
  }

  if (domainCriticalChanged) {
    add(commands, 'critical-regression', 'npm run test:regression:critical');
  }
}

console.log('Changed files:');
for (const file of files) {
  console.log(`- ${file}`);
}

console.log('\nValidation commands:');
for (const item of commands.values()) {
  console.log(`- ${item.command}`);
}

const listOnly = process.argv.includes('--list');
if (listOnly) {
  process.exit(0);
}

for (const item of commands.values()) {
  console.log(`\n> ${item.command}`);
  // security-scan-ignore: command values are assembled from fixed internal validation keys.
  const result = spawnSync(item.command, {
    shell: true,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
