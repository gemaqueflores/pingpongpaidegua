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
