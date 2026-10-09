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
