# PP-SEC-013 — evidência de implementação

Base: origin/main `215acdd`. Spec: `docs/specs/PP-SEC-013-prisma-next-major-cve.md`, SPEC ATIVA v1.

## T-U-04 RED — pré-condição de versão

EXECUTADA: suite baseline Next 15, 67 testes verdes (`tmp/pp-sec-013/unit-before.log`).
EXECUTADA: verificação independente `require('next/package.json').version.startsWith('16.')` falhou (exit 1; versão 15.5.27).
A suite existente não apresenta falha funcional baseline; RED registra a pré-condição ausente, sem introduzir teste artificial. A orientação dispensa novo arquivo unitário.

## Evidências locais

Logs completos em `tmp/pp-sec-013/` (não versionados).

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
