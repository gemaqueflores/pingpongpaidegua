# PP-SEC-014 — validação da migração para Vitest 5

Execução do Codex em 2026-10-09, a partir de `origin/main` no commit
`a9b84e95d0c833c45632cbdb6eff87f0abd3ab60`.

## Resultado

- `@cbtm/parser`: Vitest `5.0.3`, 35/35 testes, nenhum skip.
- `@cbtm/shared`: Vitest `5.0.3`, 58/58 testes, nenhum skip.
- Vite transitivo: `8.3.4`, conforme a decisão da Spec v2.
- `tinypool`: removido da árvore instalada.
- `npm audit`: 2 críticas antes e 0 depois. A contagem inicial divergiu das
  4 críticas observadas durante o CAT porque o estado do registry mudou; os
  arquivos JSON desta execução são a referência reproduzível.
- As duas `vitest.config.ts` permaneceram sem diff.

## Red-Green e corretude

| Teste | Evidência | Resultado |
|---|---|---|
| T-C-02 RED | commit `58fb74c`; `audit-before.json` | `vitest` e `tinypool` críticos |
| T-C-02 GREEN | commit `25bc958`; `audit-after.json` | `critical == 0` |
| T-C-03 | mutação temporária do alias `@cbtm/shared` | parser falhou com módulo ausente; mutação revertida |
| T-C-04 | sentinela temporária `expect(1).toBe(2)` | shared falhou com 1 teste; sentinela removida |
| Coleta | execuções reais das duas suites | 35 e 58 testes coletados; nenhuma suite vazia |

## Regressão e builds

- `npm run test:regression:critical`: verde (shared 7/7, API 52/52,
  worker 25/25).
- `npm run build --workspace @cbtm/shared`: verde.
- `npm run build --workspace @cbtm/parser`: verde.
- `npm --prefix apps/api test`: verde, 247/247.
- `npm run test --workspace apps-worker`: a primeira execução encontrou somente
  falhas de autenticação no PostgreSQL local. Repetida pelo procedimento efêmero
  aprovado na PP-072, após 28 migrações, ficou verde em 101/101. O container e
  as credenciais aleatórias foram removidos no bloco `finally`.

O Vitest emitiu aviso de que a sintaxe ESM do config em projeto CommonJS não é
suportada pelo futuro `configLoader: native`. O loader atual carregou as duas
configs e todas as suites passaram; a Spec proíbe alteração preventiva nelas.

## Lockfile e compatibilidade

O lockfile teve 93 entradas de pacote adicionadas, removidas ou com versão
alterada. O delta corresponde à troca do ecossistema Vitest 3/Vite 7 pelo
Vitest 5/Vite 8, incluindo a remoção de `tinypool`, `vite-node` e pacotes
Rollup substituídos pela cadeia resolvida do Vite 8. Não foi declarado `vite`
nem criado `overrides` em nenhum `package.json`.

Além de `vitest`, `vite` e dos demais pacotes `@vitest/*`, os majors
transitivos são: `@vitest/mocker` 3.2.7 → 5.0.3, `@vitest/spy` 3.2.7 → 5.0.3,
`chai` 5.3.3 → 6.3.0, `es-module-lexer` 1.7.0 → 2.3.2,
`magic-string` 0.30.21 → 1.4.3, `std-env` 3.10.0 → 4.3.0,
`tinybench` 2.9.0 → 6.2.1 e `why-is-node-running` 2.3.0 → 3.2.1.

Ambiente executado: Node `v24.13.0`, compatível com o engine do Vitest 5
(`^22.12.0 || ^24.0.0 || >=26.0.0`). O Node 20 dos workflows não executa estas
suites hoje e permanece registrado em PP-SEC-015 antes de futura inclusão.

## Audit remanescente

| Cadeia | Severidade | Tratamento |
|---|---|---|
| Prisma (`prisma`, `@prisma/config`, `deepmerge-ts`, `effect`) | high | Fora do escopo; atualização de Prisma exige entrega própria |
| Next/PostCSS (`next`, `postcss`) | moderate/high | Correção indicada pelo npm exige Next 16 (major), fora do escopo |
| `esbuild` | low | Transitiva e fora do escopo desta migração |

Totais após a mudança: 0 info, 1 low, 1 moderate, 5 high, 0 critical.
Nenhuma vulnerabilidade foi ocultada com `--omit`, `--force` ou supressão.

## Gates de segurança e higiene

- `verify:changed:list`, `verify:changed` e `verify:encoding`: verdes.
- O scanner de segurança do repositório sinaliza em `CLAUDE.md:33` um marcador
  histórico de renderização HTML. É falso positivo documental preexistente,
  sem código alterado nessa linha e sem relação com esta entrega.
- A varredura dedicada não encontrou segredo, entrada não confiável, comando,
  query, autenticação ou autorização introduzidos pela mudança. A superfície é
  exclusivamente de dependência de desenvolvimento e documentação.

Esta evidência relata execução e desvios; não constitui parecer de aprovação.
