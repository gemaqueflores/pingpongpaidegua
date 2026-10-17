# PP-SEC-013 — evidência de implementação

Base: origin/main `215acdd`. Spec: `docs/specs/PP-SEC-013-prisma-next-major-cve.md`, SPEC ATIVA v1.

## T-U-04 RED — pré-condição de versão

EXECUTADA: suite baseline Next 15, 67 testes verdes (`tmp/pp-sec-013/unit-before.log`).
EXECUTADA: verificação independente `require('next/package.json').version.startsWith('16.')` falhou (exit 1; versão 15.5.27).
A suite existente não apresenta falha funcional baseline; RED registra a pré-condição ausente, sem introduzir teste artificial. A orientação dispensa novo arquivo unitário.

## Evidências locais

Logs completos em `tmp/pp-sec-013/` (não versionados).
Logs de web unitário/build/E2E versionados em [validation.md](../evidence/PP-SEC-013/validation.md).

## T-B-01 RED

EXECUTADA: primeiro build Turbopack compilou em 7,8s e falhou no typecheck (exit 1).
Erros em fixtures unitárias: tipos ausentes de react-dom/server, argumento ResolvingMetadata,
null em publishedAt e nAtletasProximoEvento. Next ajustou jsx para react-jsx e incluiu tipos dev.
Log: `tmp/pp-sec-013/build-turbopack-first.log`.

## T-B-01 GREEN

EXECUTADA: build Turbopack exit 0; diretório `.next/standalone` presente.
Correções mínimas de fixtures e @types/react-dom 19.2.3 (19.3.0 exige @types/react 19.3;
mantido @types/react 19.2.13 sem forçar peers). Arquivos gerados Next preservados.

## T-E-03 GREEN

EXECUTADA: 1 teste passou em build de produção Next 16.4.2 em http://127.0.0.1:3100.
Decodificação independente do SVG versão 1 numérico, sem usar encoder nem dependência nova;
payload 12345678 recuperado. Ausente e branco: 400; conteúdo acima da capacidade: 500 tratado.
Desvio Red-Green: teste novo passou na primeira execução; commit chamado RED registra introdução,
não uma falha funcional observada. Nenhuma alteração artificial de produção para fabricar RED.
Log: `tmp/pp-sec-013/e03-first.log`. Sem refactor.

## T-E-04 GREEN e regressão completa

EXECUTADA: quatro E2E passaram em 6,1s no build Turbopack de produção.
Login hidrata: abrir/fechar recuperação de senha altera o estado React; scripts inline
usam nonce da CSP e não há erros de console/pageerror. Nenhuma credencial utilizada.
T-E-04 também passou na primeira execução; mesmo desvio RED documental de T-E-03.
Primeira suite completa: 3 verdes/1 falha por NEXT_PUBLIC_API_URL local inconsistente
com o fallback da CSP. Rebuild com NEXT_PUBLIC_API_URL=http://localhost:4000 resolveu
sem alterar middleware, política ou testes T-E-01/T-E-02. Log final:
`tmp/pp-sec-013/e2e-final-consistent.log`. Sem refactor.

## Validação e decisões

- EXECUTADA: web 67/67; API 247/247; builds web e API exit 0; hook `.githooks` ativo,
  cerca crítica executada em todos os commits, sem --no-verify.
- EXECUTADA: build padrão Turbopack; middleware-manifest aponta chunks server/edge.
  `apps/web/middleware.ts` permanece intacto, sem proxy.ts ou mudança de runtime.
- EXECUTADA: ANALYZE=true com `next build apps/web --webpack` exit 0; gerou client.html,
  edge.html e nodejs.html. @next/bundle-analyzer declara incompatibilidade com Turbopack:
  Webpack usado somente para análise, sem mudar build padrão. Config original preservada.
- EXECUTADA: audit produção passou de 0 crítica/5 altas/1 moderada para 0/4/0,
  somente prisma, @prisma/config, deepmerge-ts e effect. Exit 1 esperado pelas 4 altas.
- EXECUTADA: encoding e scanner de segurança com caminhos explícitos da entrega: exit 0.
  verify:changed global: exit 1 em encoding de arquivos preexistentes não rastreados
  (.codex-worktrees, docs/evidence/PP-063); segurança global: exit 1 em arquivos
  alheios (.claude, .codex-worktrees e orientações anteriores). Não alterados.
- ESTÁTICA: rota PIX usa request.nextUrl.searchParams; nenhuma API síncrona removida.
  Rota e contrato preservados; E2E confirma comportamento observado.
- Avisos mantidos: middleware/Edge deprecated; next start com output standalone;
  warnings existentes de Vite/config e NO_COLOR. Não representam falha dos testes.
- Assunção: baseline origin/main 215acdd; testes locais usam API interceptada e não
  comprovam integração com banco nem deploy. Sem publicação em produção.
- Exclusões: apps/api/src, Prisma/overrides, Docker, PP-SEC-015/016, arquivos locais
  de outras sessões. PP-SEC-017 criado sem Spec, aguardando correção upstream.

## Mapa T-* e commits

| ID | Evidência | RED | GREEN | Refactor |
|---|---|---|---|---|
| T-U-04 | apps/web/tests/**/*.test.tsx (suite existente) | 1d11026 (pré-condição) | 4e58606 | sem refactor |
| T-B-01 | next build + inspeção .next/standalone | 7875458 | 0616f00 | sem refactor |
| T-E-03 | apps/web/e2e/csp-nonce.spec.ts:126 | f5d5d08 (introdução, sem falha observada) | 2c8b640 | sem refactor |
| T-E-04 | apps/web/e2e/csp-nonce.spec.ts:143 | a9705f7 (introdução, sem falha observada) | 3323887 | sem refactor |

Próximo responsável: Claude, revisão solicitada por Leo após abertura do PR.
