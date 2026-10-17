# Entrega PP-SEC-015/016 — CI de testes e audit

Projeto: PingPong PaiDegua | Etapa: Implementacao | Autor: Codex
Artefato: PP-SEC-015-016, SPEC ATIVA v1 | Estado: implementado, aguardando revisao Claude
Proximo responsavel: Claude; Leo confirma T-I-01 depois da abertura do PR.

Branch: `fix/pp-sec-015-016-ci-testes-audit`, base `origin/main` em `41d9c6d`.

## Implementacao

- `.github/workflows/pr-checks.yml`: PR contra main e push main, jobs test/audit independentes, Node 24, permissao contents: read, sem secrets.
- Test: npm ci, Prisma Client explicito, migrations em PostgreSQL descartavel, npm test raiz e testes novos do gate.
- Audit: npm audit --json completo, incluindo devDependencies. Status do comando preservado; criticas e falhas operacionais bloqueiam. Altas/moderadas/baixas passam.
- Node 24 nos dois workflows existentes que usam setup-node; PP-SEC-015/016 fechados no backlog com revisao/merge e T-I-01 declarados pendentes.

## Red-Green executado

| ID | Teste | RED | GREEN | Refactor |
|---|---|---|---|---|
| T-U-05 | scripts/audit-gate.test.ts:17 | 6c3b15a | 62a3ddf | sem refactor |
| T-U-06 | scripts/audit-gate.test.ts:23 | b5b6afd | 7879654 | sem refactor |
| T-U-07 | scripts/audit-gate.test.ts:28 | 2bf8607 | ec45a79 | sem refactor |

REDs falharam antes das respectivas implementacoes; GREENs passaram. T-U-07 inclui entrada ausente/malformada, erro de rede, formato incorreto, contagens invalidas/inconsistentes e status operacional inesperado. Os testes executam o script real como subprocesso.

## Evidencia executada

- `npx tsx --test scripts/audit-gate.test.ts`: 3 testes, 3 pass, 0 fail.
- `npm run prisma:generate` e `npm run prisma:deploy`: sucesso contra PostgreSQL 16 descartavel local, porta 55432.
- `npm test` com DATABASE_URL desse banco: parser 35/35, shared 58/58, API 247/247, worker 101/101; exit 0.
- Builds API e Web: exit 0. Web manteve aviso preexistente de deprecacao do Edge Runtime.
- Audit completo real: info=0, low=1, moderate=0, high=4, critical=0, total=5. Gate exit 0.
- YAML dos tres workflows parseado com PyYAML; jobs independentes e permissao contents: read conferidos. Isto e evidencia estatica, nao execucao do Actions.
- Encoding direcionado aos seis arquivos implementados: passou; git diff --check sem erro.
- Hook ativo: core.hooksPath=.githooks. Todos os commits passaram pelo hook, sem --no-verify; cerca critica executada em cada commit.

Logs locais em `$env:TEMP`: `pp-sec-015-016-red05.log`, `pp-sec-red06.log`, `pp-sec-red07.log`, `pp-sec-green07.log`, `pp-sec-suite-clean-db.log`, `pp-sec-prisma.log`, `pp-sec-migrate.log`, `pp-sec-build-api.log`, `pp-sec-build-web.log`.

## Self-check de seguranca e limites

`verify:changed` interrompido por encoding preexistente fora do escopo (.codex-worktrees e docs/evidence/PP-063). `verify:security` geral sinalizou arquivos preexistentes em .claude, .codex-worktrees e sessions; nao foram alterados.

Scanner deterministico e `verify:security` direcionado sinalizaram somente spawnSync no teste novo. Inspecao: executavel process.execPath, argumentos fixos, fixtures via stdin, sem shell e sem interpolacao de entrada em comando; achado explicado, nenhuma supressao adicionada. Credenciais ci/ci sao exclusivas do banco efemero do runner, sem relacao com producao.

Assuncao/ajuste necessario: a suite worker contem testes de integracao reais com PostgreSQL. A primeira execucao sem banco isolado falhou por autenticacao; por isso o job inclui service postgres:16-alpine com healthcheck e prisma:deploy. Nenhum teste foi alterado ou omitido. A reexecucao com banco isolado passou.

Fora do escopo: deploy-backend.yml, scrape-every-2h.yml, hook local, apps-web na suite CI, branch protection, PP-SEC-017, revisao periodica de knowledge/CLAUDE.md e demais arquivos locais preexistentes.

T-I-01 NAO VERIFICADA: execucao real no GitHub Actions fica para Leo apos o PR existir; validacao local nao confirma esse ID. Sem merge ou deploy autorizado nesta entrega.
