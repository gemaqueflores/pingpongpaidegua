import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

// T-I-01/T-I-02/T-I-03 — PP-050
// Verifica que o build Docker local do frontend recebe NEXT_PUBLIC_API_URL como build arg e que o CSP
// gerado (routes-manifest.json) reflete a origem local, sem afetar o fallback de produção em
// next.config.js nem o build direto (fora do Docker).

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const IMAGE_TAG = "appcbtmeventos-web-csp-test";

function runDockerBuild(): void {
  execFileSync(
    "docker",
    [
      "compose",
      "--profile",
      "local-ui",
      "build",
      "--build-arg",
      "NEXT_PUBLIC_API_URL=http://localhost:4000",
      "frontend",
    ],
    { cwd: repoRoot, stdio: "pipe" },
  );
}

function readManifestConnectSrc(): string {
  // Constrói a imagem via docker-compose (usa o serviço "frontend" já configurado) e inspeciona o
  // routes-manifest.json gerado dentro dela, sem precisar subir o container.
  const containerName = `${IMAGE_TAG}-inspect`;
  execFileSync("docker", ["rm", "-f", containerName], { stdio: "pipe" }).toString?.();
  try {
    execFileSync(
      "docker",
      ["create", "--name", containerName, "appcbtmeventos-frontend"],
      { stdio: "pipe" },
    );
    const manifestJson = execFileSync("docker", [
      "run",
      "--rm",
      "--entrypoint",
      "cat",
      "appcbtmeventos-frontend",
      "/workspace/apps/web/.next/routes-manifest.json",
    ]).toString("utf8");
    const manifest = JSON.parse(manifestJson) as {
      headers?: Array<{ headers?: Array<{ key: string; value: string }> }>;
    };
    const cspHeader = manifest.headers
      ?.flatMap((entry) => entry.headers ?? [])
      .find((header) => header.key === "Content-Security-Policy");
    assert.ok(cspHeader, "Content-Security-Policy header ausente no routes-manifest.json");
    const connectSrcMatch = cspHeader!.value.match(/connect-src[^;]*/);
    assert.ok(connectSrcMatch, "diretiva connect-src ausente no CSP gerado");
    return connectSrcMatch![0];
  } finally {
    try {
      execFileSync("docker", ["rm", "-f", containerName], { stdio: "pipe" });
    } catch {
      // container pode não ter sido criado se o docker create falhou antes
    }
  }
}

test("T-I-01 — build arg propaga NEXT_PUBLIC_API_URL para o CSP do build Docker local", () => {
  runDockerBuild();
  const connectSrc = readManifestConnectSrc();
  assert.match(connectSrc, /http:\/\/localhost:4000/, `connect-src não contém a origem local: ${connectSrc}`);
  assert.doesNotMatch(
    connectSrc,
    /api-pingpongpaidegua\.duckdns\.org/,
    `connect-src ainda aponta para produção: ${connectSrc}`,
  );
});

test("T-I-02 — fallback de produção permanece intacto em next.config.js (regressão)", () => {
  const nextConfigPath = path.join(repoRoot, "apps", "web", "next.config.js");
  const source = readFileSync(nextConfigPath, "utf8");
  assert.match(
    source,
    /process\.env\.NEXT_PUBLIC_API_URL\s*\?\?\s*"https:\/\/api-pingpongpaidegua\.duckdns\.org"/,
    "fallback de produção não foi encontrado — next.config.js não deveria ter sido alterado por esta Spec",
  );
});

test("T-I-03 — build direto (fora do Docker) continua funcionando sem build arg", () => {
  execFileSync("npm", ["run", "build", "--workspace", "apps-web"], {
    cwd: repoRoot,
    stdio: "pipe",
    shell: true,
  });
});
