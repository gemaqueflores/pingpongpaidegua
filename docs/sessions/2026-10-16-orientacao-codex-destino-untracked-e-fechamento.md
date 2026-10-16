# Orientação para o Codex — destino dos 7 untracked bloqueadores e fechamento final

Autorização: Leo aprovou nesta sessão (2026-10-16). Canal formal — Claude não executa Git de escrita.

Contexto: push do encerramento PP-062 confirmado (`8aa6cb2`, verificado por Claude via
`git log -1 origin/main` e `git ls-remote`). Falta só resolver os 7 arquivos untracked que bloqueiam
`git switch main` no checkout principal.

## Verificação feita por Claude nos 4 arquivos que "diferem de main"

Comparados via `diff <(git show origin/main:<arquivo>) <arquivo>`:

- `docs/specs/PP-062-backfill-normalizacao-clubes.md`: já tratado — `origin/main` tem a versão com
  histórico de encerramento (commit `8aa6cb2`); o local é a versão anterior sem esse fechamento.
- `docs/specs/PP-071-exposicao-publica-suporte-cors.md`: `origin/main` tem 52 linhas a mais — o Parecer
  Rodada 1 completo (score ✅6/⚠️5/❌1, PR #64). O local não tem esse parecer.
- `docs/specs/PP-072-atualizacao-dependencias-cve.md`: mesmo padrão — `origin/main` tem 96 linhas a
  mais, o Parecer Rodada 1 completo (score ✅5/⚠️5/❌0, PR #63). Local sem o parecer.
- `docs/specs/PP-SEC-014-migracao-vitest-5.md`: `origin/main` está na v2.1 (correções do Parecer Rodada
  1 já aplicadas e aprovadas por Leo); o local é a v2, anterior.

Em todos os 4 casos, sem exceção: **`origin/main` é estritamente mais completo/mais recente**. Nenhum
contém trabalho exclusivo do checkout local que `origin/main` não tenha. Os outros 3 (confirmados
idênticos pelo Codex no relatório anterior — PP058/059/060/062-P0, retorno-codex-pp062-worktrees,
PP-070) já batem com main.

## Ação — descartar os 7, sincronizar o checkout

Nenhum dos 7 precisa ser preservado antes do descarte. Ação:

```
rm "docs/specs/PP-062-backfill-normalizacao-clubes.md" \
   "docs/specs/PP-071-exposicao-publica-suporte-cors.md" \
   "docs/specs/PP-072-atualizacao-dependencias-cve.md" \
   "docs/specs/PP-SEC-014-migracao-vitest-5.md" \
   "docs/sessions/2026-09-19-PP058-PP059-PP060-PP062-P0-clubes-duplicados.md" \
   "docs/sessions/2026-10-16-retorno-codex-pp062-worktrees.md" \
   "docs/specs/PP-070-borda-cache-autenticado-ip-cliente.md"

git switch main
git pull origin main
git log origin/main..fix/pp-062-backfill-normalizacao-clubes --oneline   # reconfirmar vazio
git branch -d fix/pp-062-backfill-normalizacao-clubes
```

Isso deixa o checkout principal limpo, em `main`, sincronizado com `origin/main` (que já tem as versões
corretas desses 7 arquivos). Os demais untracked (specs/sessions de PP-047 a PP-061, PP-063 a PP-069,
PDFs, `.claude/`, `.codex-worktrees/`, `scripts/pp-053-merge-clubs-recidiva.ts`) continuam fora de
escopo deste bloco — não tocar neles aqui.

## Também fechar — worktree documental em detached HEAD

A worktree `.codex-worktrees/appcbtmeventos-pp062-docs` ficou em detached HEAD no commit `8aa6cb2`
(já mergeado e pushado). Remover:

```
git worktree remove .codex-worktrees/appcbtmeventos-pp062-docs
```

## Bloco B (PEND-CBTM-006) — autorizado a fechar

Claude concorda com a análise do Codex: `origin/main` já cobre ou supera as 3 dependências que a
worktree `pend-cbtm-006-web-audit` estava atualizando (Next 15.5.27 ≥ 15.5.25, Sharp 0.35.5 ≥ 0.35.4,
nanoid 3.3.19 = 3.3.19) — fechado por PP-072/PP-SEC-014. Autorizado descartar e remover:

```
git -C appcbtmeventos-worktrees/pend-cbtm-006-web-audit checkout -- package-lock.json
git worktree remove appcbtmeventos-worktrees/pend-cbtm-006-web-audit
git branch -d fix/pend-cbtm-006-web-audit
```

PEND-CBTM-006 já está marcada fechada em `CLAUDE.md` (confirmado por Claude) — não precisa de novo
registro.

## Reportar ao final
Confirmação de: checkout em `main` limpo, branch `fix/pp-062-...` removida, worktree de docs removida,
worktree + branch de `pend-cbtm-006` removidas, `git worktree list` e `git branch -vv` finais.
