import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const repositoryRoot = resolve(__dirname, "../../..");

test("PP-070 T-S-01: nginx ignora cache autenticado e sobrescreve XFF", () => {
  const nginxConfig = readFileSync(
    resolve(repositoryRoot, "scripts/vm/nginx-api-site.conf"),
    "utf8",
  );
  const runbook = readFileSync(
    resolve(repositoryRoot, "docs/runbook-producao-oracle-vercel.md"),
    "utf8",
  );
  const locationBodies = [...nginxConfig.matchAll(/location[^\{]*\{([\s\S]*?)^\s*\}/gm)]
    .map((match) => match[1] ?? "")
    .filter((body) => /\bproxy_cache\s+api_microcache;/.test(body));

  assert.equal(locationBodies.length, 2, "deve localizar os dois blocos com microcache");
  for (const body of locationBodies) {
    assert.match(body, /proxy_no_cache\s+\$http_authorization;/);
    assert.match(body, /proxy_cache_bypass\s+\$http_authorization;/);
  }

  assert.doesNotMatch(nginxConfig, /\$proxy_add_x_forwarded_for/);
  assert.doesNotMatch(runbook, /\$proxy_add_x_forwarded_for/);
  assert.match(nginxConfig, /proxy_set_header X-Forwarded-For \$remote_addr;/);
});

test("PP-070 T-S-02: RATE_LIMIT_TRUST_PROXY foi removida", () => {
  const files = [
    resolve(repositoryRoot, "docker-compose.yml"),
    resolve(repositoryRoot, "apps/api/.env.example"),
    ...listTypeScriptFiles(resolve(repositoryRoot, "apps/api/src")),
  ];

  for (const file of files) {
    assert.doesNotMatch(
      readFileSync(file, "utf8"),
      /RATE_LIMIT_TRUST_PROXY/,
      `variavel obsoleta encontrada em ${file}`,
    );
  }
});

function listTypeScriptFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTypeScriptFiles(path));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(path);
    }
  }
  return files;
}
