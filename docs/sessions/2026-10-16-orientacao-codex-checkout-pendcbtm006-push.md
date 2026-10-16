# Orientação para o Codex — sincronizar checkout principal, decidir PEND-CBTM-006, push do encerramento PP-062

Autorização: Leo aprovou nesta sessão (2026-10-16) prosseguir com as ações abaixo. Claude não executa
Git de escrita neste projeto — este arquivo é o canal formal de instrução.

Contexto: a verificação de produção da PP-062 (relatório anterior) confirmou 0 duplicatas, e o
encerramento documental já foi commitado localmente em `main` (`8aa6cb2`), sem push. Ainda restam 3
itens read/write pendentes antes de considerar a sessão fechada.

---

## Bloco A — Sincronizar o checkout principal com `origin/main` (resolve o bloqueio anterior)

Claude investigou as 3 mudanças "locais preexistentes" que impediam o checkout principal de voltar para
`main` (`CLAUDE.md`, `docs/backlog-seguranca-qualidade.md`, `docs/knowledge/CLAUDE.md`, modificados no
working tree da branch `fix/pp-062-backfill-normalizacao-clubes`). Confirmado por `git diff origin/main
-- <arquivo>`: **não é trabalho novo em andamento** — é o working tree desatualizado reescrevendo esses 3
arquivos para uma versão **anterior e pior** do que já está em `origin/main`:

- `CLAUDE.md`: o working tree reabriria PEND-CBTM-006 (que `origin/main` já tem fechada por PP-072/PP-SEC-014,
  revalidada em 2026-10-09).
- `docs/backlog-seguranca-qualidade.md`: o working tree reabriria PP-SEC-007 (fechado por PP-072) e
  **PP-SEC-008** (fechado por revogação — Leo já confirmou em 2026-09-27 que o token tinha formato real em
  2 commits e já revogou), e removeria as entradas PP-SEC-013 a PP-SEC-016 que já existem em `origin/main`.
- `docs/knowledge/CLAUDE.md`: working tree tem só 3 linhas a mais que `origin/main` não tem, e está
  faltando 137 linhas que `origin/main` já ganhou.

**Nenhuma dessas 3 mudanças locais deve ser preservada.** São resíduo de checkout parado, não edição
pendente. Ação:

```
git checkout -- CLAUDE.md docs/backlog-seguranca-qualidade.md docs/knowledge/CLAUDE.md
git log origin/main..HEAD --oneline   # confirmar que segue vazio (sem commit exclusivo perdível)
git status --short                     # revisar o que resta (untracked de specs/sessions antigas, etc.)
git checkout main
git pull origin main
git branch -d fix/pp-062-backfill-normalizacao-clubes
```

Antes do `git branch -d`: se o `git log origin/main..HEAD --oneline` mostrar qualquer commit (não deveria,
já verificado vazio duas vezes), parar e reportar a Claude em vez de deletar.

Os arquivos untracked restantes (specs/sessions de PP-047 a PP-072, PDFs, `.claude/`, `.codex-worktrees/`)
não fazem parte deste bloco — não mexer neles aqui, só confirmar que `git checkout -- <3 arquivos>` e a
troca de branch não os afeta (são untracked, não rastreados, `checkout`/`branch -d` não os toca).

---

## Bloco B — PEND-CBTM-006: decisão conjunta sobre o lockfile da worktree de auditoria

**Achado novo e relevante, descoberto no Bloco A:** `origin/main` já tem PEND-CBTM-006 **fechada**
(por PP-072 + PP-SEC-014, revalidada em 2026-10-09) com um caminho diferente do que a worktree
`appcbtmeventos-worktrees/pend-cbtm-006-web-audit` estava explorando. Antes de decidir o que fazer com o
`package-lock.json` modificado nessa worktree (Next 15.5.12→15.5.25, Sharp 0.34.5→0.35.4, nanoid
3.3.11→3.3.19), precisamos saber se esse trabalho ainda tem valor ou se já foi superado.

Pedido ao Codex:
1. Ler a entrada fechada de PEND-CBTM-006 em `origin/main:CLAUDE.md` (a versão nova, já sincronizada
   pelo Bloco A) e comparar com o que a atualização de lockfile da worktree `pend-cbtm-006-web-audit`
   estava tentando resolver.
2. Se for o mesmo problema já resolvido por outro caminho (PP-072/PP-SEC-014): reportar a Claude que a
   worktree é obsoleta — decisão conjunta então é descartar o `package-lock.json` modificado
   (`git checkout -- package-lock.json` nessa worktree) e remover a worktree
   (`git worktree remove appcbtmeventos-worktrees/pend-cbtm-006-web-audit`), já que a branch
   `fix/pend-cbtm-006-web-audit` nunca teve PR nem commit do lockfile.
3. Se for um problema diferente (ex. vulnerabilidade específica de `apps/web` não coberta pelo escopo de
   PP-072, que tocou principalmente API/worker): reportar a Claude o que especificamente falta, para
   decidirmos se vale abrir uma Spec nova ou também descartar.

Não descartar nem commitar nada nesta worktree até esse comparativo ser reportado e Claude/Leo
confirmarem o caminho.

---

## Bloco C — Push do encerramento documental da PP-062

Após o Bloco A (checkout principal sincronizado e limpo), decidir sobre o commit `8aa6cb2` que já está
em `main` local (Spec PP-062 + histórico + relatório de verificação, só documentação, sem código):

```
git log -1 --stat 8aa6cb2   # reconfirmar que são só os 3 arquivos de doc, nada de código
git push origin main
```

Leo autorizou nesta sessão. Reportar o resultado do push (hash remoto confirmado) ou qualquer rejeição
(ex. `origin/main` avançou entre a leitura e o push — nesse caso, não forçar, reportar a divergência).

---

## Reportar ao final

- Bloco A: confirmação do checkout de volta a `main`, branch `fix/pp-062-...` removida, estado final de
  `git branch -vv` e `git worktree list`.
- Bloco B: comparação PEND-CBTM-006 (fechada em main vs. trabalho da worktree) e decisão tomada (ou
  pendência levantada para Claude/Leo).
- Bloco C: confirmação do push ou motivo de não ter sido possível.
