# PP-SEC-014 — evidência RED

Data: 2026-10-09
Base: `origin/main` em `a9b84e95d0c833c45632cbdb6eff87f0abd3ab60`
Node: `v24.13.0`

## T-C-02 — audit completo antes da migração

Comando:

```text
npm audit --json
```

Resultado autoritativo deste ciclo:

```text
info=0 low=1 moderate=2 high=5 critical=2 total=10
critical: tinypool, vitest
```

O comando terminou com código diferente de zero porque havia vulnerabilidades. O JSON integral está em
`audit-before.json`. A contagem anterior de quatro críticas, observada durante o CAT, não se repetiu; advisories
do registry são temporais e esta execução limpa sobre `origin/main` passa a ser o baseline da implementação.

## Baseline funcional

```text
npm run test --workspace @cbtm/parser  -> 11 arquivos, 35 testes, 35 passaram
npm run test --workspace @cbtm/shared -> 10 arquivos, 58 testes, 58 passaram
```

Após `npm ci`, `npm ls vitest vite tinypool` mostrou uma única instalação de `vitest@3.2.7`,
`vite@7.3.6` e `tinypool@1.1.1`. `npx --no-install vitest --version` respondeu normalmente.

## T-C-03 — alias exercido

Após a migração para Vitest 5, o alias `@cbtm/shared` foi temporariamente apontado para
`../shared/src/__pp_sec_014_missing__.ts`. O comando abaixo terminou com código 1 e informou que não encontrou
`@cbtm/shared`, provando que o teste percorre o alias real:

```text
npm run test --workspace @cbtm/parser -- doubles-parser.test.ts
```

A mutação foi revertida imediatamente e não faz parte de nenhum commit.

## T-C-04 — sentinela anti-vacuidade

Foi criado temporariamente `packages/shared/test/zz-vitest5-sentinel.test.ts` com `expect(1).toBe(2)`.
`npm run test --workspace @cbtm/shared` terminou com código 1, apontou explicitamente a sentinela e reportou
`1 failed | 58 passed`. O arquivo foi removido imediatamente e não faz parte de nenhum commit.
