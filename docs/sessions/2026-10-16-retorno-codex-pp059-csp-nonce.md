# Retorno Codex — PP-059 — 2026-10-16

Implementação para revisão de Claude, sem parecer formal. Spec: `docs/specs/PP-059-csp-nonce-middleware.md`, seção SPEC ATIVA v1; orientação de 2026-10-16.

- Branch: `fix/pp-059-csp-nonce-middleware`, base `main` / `e41cb2e`.
- Commit de código/testes: `2502461` (o commit documental posterior contém este relatório).
- PR draft: https://github.com/gemaqueflores/pingpongpaidegua/pull/67
- Preview: https://pingpongpaidegua-9decmm6jq-gemaqueflores-s-projects.vercel.app
- Skills aplicadas: florestech-implementacao, security-review-agent, e2e-playwright-agent. Sem subagentes.

## Mudança

`apps/web/middleware.ts` gera nonce com Web Crypto, substitui valores recebidos do cliente e propaga `x-nonce` e CSP no request interno. Emite CSP na resposta, sem header público `x-nonce`. A CSP interna permite que Next.js aplique o nonce nos scripts do framework. A CSP estática e suas constantes foram removidas de `next.config.js`; preservados redirects, bundle analyzer e standalone.

`script-src` contém apenas `'self'` e nonce; demais diretivas preservadas, inclusive `style-src 'unsafe-inline'` e origem configurada da API. Matcher testado pelo utilitário real do Next.js: exclui `/api/pix-qrcode`, query string dessa rota, `_next/static`, `_next/image` e favicon; inclui home, evento e admin.

## Desvios e assunções

1. Alterado `apps/web/app/layout.tsx` com `export const dynamic = "force-dynamic"`. Necessidade declarada durante a execução: o primeiro build confirmou home e várias rotas estáticas; T-E-01 reproduziu página sem conteúdo funcional sob nonce. O middleware sozinho não torna essas páginas dinâmicas. O segundo build e browser confirmaram a correção. Referência: https://nextjs.org/docs/15/app/guides/content-security-policy — nonce requer renderização dinâmica. A perda de otimização estática já era impacto previsto no CAT; não foi adicionada funcionalidade de produto.
2. Não existiam script `test:e2e` nem configuração Playwright no web. Adicionados script, config, testes e dependência `@playwright/test` 1.58.2, preservando a versão Playwright do worker no lockfile. Config aceita `E2E_BASE_URL`, URL da API e bypass de Preview por ambiente; requer servidor já iniciado e Chromium instalado.
3. Fixture HTML isolada é entregue apenas por interceptação Playwright e recebe CSP real obtida do servidor. Nenhuma rota de fixture foi adicionada ao app. Testa nonce correto, ausente e incorreto. RED T-E-02 falhou pela fixture ainda ausente; não representa uma regressão de produção nem prova isolada de falha de CSP. GREEN prova o bloqueio real no Chromium.
4. Mock de API usa listas vazias e `{ "ranking": [] }` em eficiência, sem dados de negócio inventados. Validação reforçada após execução em Preview: espera final do carregamento e ausência de `pageerror`.
5. Vercel Preview injeta `https://vercel.live/_next-live/feedback/feedback.js`, bloqueado pela política. Apenas essa violação esperada da barra opcional é identificada separadamente no smoke; nenhuma permissão externa foi adicionada à CSP. Scripts da aplicação executam com nonce e a home hidrata.
6. O banco local original recusou autenticação em 16 testes do worker. A suíte foi repetida com PostgreSQL 16 temporário isolado (`pp059-test-postgres`, porta 55439), com todas as migrations aplicadas. Nenhum dado operacional foi usado para os testes de integração.

## RED / GREEN / REFACTOR

| ID | Teste | RED | GREEN | Refactor |
|---|---|---|---|---|
| T-U-01 | `apps/web/tests/csp-nonce.test.tsx:6` | `b9cc259` | `c9b77a8` | sem refactor |
| T-U-02 | `apps/web/tests/csp-nonce.test.tsx:37` | `521e9dc` | `abe8ddf` | sem refactor |
| T-U-03 | `apps/web/tests/csp-nonce.test.tsx:24` | `04e4460` | `4ba8470` | sem refactor |
| T-E-01 | `apps/web/e2e/csp-nonce.spec.ts:5` | `61b5780` | `578694b` | `2502461` |
| T-E-02 | `apps/web/e2e/csp-nonce.spec.ts:42` | `81da8ec` | `1172696` | `2502461` |

Todos os commits usaram hook normal, sem `--no-verify`. `git config core.hooksPath` retornou `.githooks`. O hook executou cerca crítica e encoding staged; falhas de preparação local (pacote compartilhado sem build e cliente Prisma não gerado após npm ci) foram corrigidas e os commits repetidos com hook normal. Nenhum commit parcial dessas tentativas foi criado.

## Validação EXECUTADA

- `npm ci --prefer-offline`: instalação final concluída com lockfile incremental. Audit informou 7 vulnerabilidades (1 baixa, 1 moderada, 5 altas); não foi executado audit fix fora da Spec.
- `npm test` com `DATABASE_URL` do PostgreSQL temporário: parser 35/35, shared 58/58, API 247/247, worker 101/101. Último log: [pp059-suite-isolated.log](../../tmp/pp059-suite-isolated.log).
- `npm run test --workspace apps-web`: 64/64, inclui os três T-U. Log: [pp059-web-final.log](../../tmp/pp059-web-final.log).
- Builds shared, parser, API, worker e web: concluídos. Web inclui standalone e checagem de tipos do Next.js. Logs: `tmp/pp059-api-build.log`, `tmp/pp059-worker-build.log`, `tmp/pp059-e01-green-build.log`.
- `npm run test:e2e --workspace apps-web` em standalone: 2/2, último log [pp059-standalone-e2e-final.log](../../tmp/pp059-standalone-e2e-final.log).
- Mesmo comando com `E2E_BASE_URL` do Preview e bypass obtido em memória pela API Vercel: 2/2; último log [pp059-vercel-e2e.log](../../tmp/pp059-vercel-e2e.log).
- `npm run verify:encoding -- <arquivos da entrega>` e `npm run verify:security -- <fontes/configs/testes unitários>`: passaram; scanner direto inicial também passou. A fixture contém scripts inline intencionais, exercitados pelo browser. Logs scoped em `tmp/pp059-encoding-final.log` e `tmp/pp059-security-final.log`.
- `git diff --check main -- apps/web package-lock.json`: sem erros de whitespace.

### Smoke standalone — EXECUTADA

Comandos: `npm run build --workspace apps-web`; copiar `.next/static` e `public` para `.next/standalone/apps/web/`; iniciar `node apps/web/.next/standalone/apps/web/server.js` com `PORT=3100`, `HOSTNAME=127.0.0.1`, `NEXT_PUBLIC_API_URL=http://localhost:4000`; `curl.exe -sSI http://127.0.0.1:3100/`.

Saída real (extrato):

```text
HTTP/1.1 200 OK
content-security-policy: default-src 'self'; script-src 'self' 'nonce-MjkwYmFhOGMtNzg4MC00MjJjLWExNGQtZDE0Zjg0NTRkZDM3'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' http://localhost:4000; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate
```

Browser: home funcional, scripts inline do framework com nonce da resposta, nonce diferente na segunda requisição, PIX sem CSP; fixture autoriza nonce correto e bloqueia os outros dois scripts.

### Smoke Vercel Preview — EXECUTADA

Comandos: `vercel deploy --yes --token $env:VERCEL_TOKEN`; `node <vercel-cli>/dist/vc.js curl / --deployment <Preview acima> --token $env:VERCEL_TOKEN -- --head --silent`. Usado entrypoint Node para preservar `--` no PowerShell. Conta confirmada por `vercel whoami`: `gemaqueflores`.

Saída real (extrato):

```text
HTTP/1.1 200 OK
Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-ZDFlMTQ5MjMtYzBkMS00ZmU4LTgxMzQtNGMzY2NlNzE2NjY3'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' https://api-pingpongpaidegua.duckdns.org; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate
Server: Vercel
X-Vercel-Cache: MISS
```

Browser Chromium: 2/2, mesmas verificações do standalone. Credenciais e bypass foram usados em memória, sem inclusão em arquivos versionados. O CLI gerou bypass de proteção do projeto para o smoke; proteção de Preview permaneceu ativa.

## Limitações declaradas

- `npm run verify:changed` interrompe em encoding de arquivos locais preexistentes, incluindo `.codex-worktrees/` e evidências PP-063; `verify:security` global também identifica menções documentais a HTML perigoso. Esses arquivos foram preservados. Validação discriminativa passou nos arquivos desta entrega.
- `npx tsc --noEmit --incremental false --project apps/web/tsconfig.json` acusa erros em testes web preexistentes (tipos react-dom/server, ResolvingMetadata, nulls). Não há erro nos novos arquivos PP-059. `next build` local e remoto concluíram.
- Arquivos intencionalmente fora: `apps/web/lib/auth.ts`, páginas/componentes exceto as três linhas necessárias no layout raiz, regras de estilo, backlog e Spec alterados previamente por outra sessão, PP-063, script PP-053 e demais órfãos locais.
- Sem merge, atualização de backlog institucional ou deploy de produção. Próximo responsável: Claude para revisão do PR draft.
