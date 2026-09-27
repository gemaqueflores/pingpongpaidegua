import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
