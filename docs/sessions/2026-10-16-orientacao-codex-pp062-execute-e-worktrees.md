# Orientação para o Codex — PP-062 (dry-run + execute) e limpeza de worktrees órfãs

Autorização: Leo aprovou nesta sessão (2026-10-16) a execução das ações abaixo. Claude não executa Git
de escrita neste projeto (regra do contrato FloresTech) — este arquivo é o canal formal de instrução.

## Atualização (2026-10-16, após retorno parcial do Codex) — chave SSH de produção

Caminho local da chave de produção (lido do CLAUDE.md do projeto, confirmado presente no disco):
`C:/Users/LeonardoMuriloGemaqu/Documents/estudos/ssh-keys/pingpongpaidegua/ssh-key-2026-04-02.key`.
Conexão: host `129.213.86.180`, user `ubuntu`, via `ssh_connect` (MCP `ssh-oracle`) com
`privateKeyPath` apontando para esse arquivo. Retomar a partir do Passo 2.0 abaixo.

## Atualização (2026-10-16) — divergência real do checkout principal confirmada

Claude reconferiu: `git log origin/main..HEAD` na branch `fix/pp-062-backfill-normalizacao-clubes` está
vazio (nenhum commit exclusivo — consistente com o PR #60 já mergeado), **mas** `git diff origin/main
HEAD --stat` mostra 39 arquivos divergentes e `git status -sb` confirma a branch desatualizada em
relação a `origin/main` (commits de PP-070/071/072/PP-SEC-014 já estão em `origin/main` e não estão no
checkout local). O relatório do Codex de "38 commits atrás de origin/main" está correto — a leitura
anterior de Claude (diff vazio) estava desatualizada, feita antes dessas entregas serem mergeadas.

**Correção à instrução original do Bloco 1 sobre o checkout principal:** não fazer checkout direto para
`main` nem deletar a branch local ainda. Antes: `git fetch origin` (se ainda não feito) e
`git log origin/main..HEAD --oneline` para reconfirmar que segue vazio (sem commits exclusivos reais
perdíveis). Confirmado isso, seguro fazer `git checkout main && git pull` e então
`git branch -d fix/pp-062-backfill-normalizacao-clubes`. Reportar o resultado antes de prosseguir, caso
apareça qualquer commit exclusivo inesperado.

**PP-060 preservada corretamente** — 3 commits exclusivos (`1315505`, `89908c3`, `1054e7c`) nunca
mergeados (PR #58 fechado sem merge, conforme decisão da própria Spec PP-062). Não deletar essa branch
nem a worktree. Mantê-la como está.

**Resíduos de pasta vazia** (`Directory not empty` ao remover worktrees de PP-071/072/056): são inofensivos
— `git worktree remove` já retirou o registro Git; as pastas físicas residuais podem ser limpas depois com
um comando de remoção de diretório comum, sem urgência, não bloqueiam nada.

---

## Bloco 1 — Limpeza de worktrees órfãs (git de escrita, sem ambiguidade)

Confirmado por `git log origin/main..<branch>` nesta sessão: as 4 branches abaixo têm **zero commits
exclusivos** fora de `origin/main` — já mergeadas, worktree é resíduo pós-merge.

1. `chore/pp-060-saneamento-clubes-duplicados-residuo` — worktree
   `C:/Users/LeonardoMuriloGemaqu/Documents/estudos/.codex-worktrees/appcbtmeventos-pp060`.
   PR #58 **CLOSED sem merge** (decisão explícita da Spec PP-062: PP-060 foi substituída por PP-062).
2. `fix/pp-072-dependencias-cve` — worktree
   `C:/Users/LeonardoMuriloGemaqu/Documents/estudos/.codex-worktrees/orq-006/pp072`. PR #63 MERGED.
3. `fix/pp-071-suporte-cors` — worktree
   `C:/Users/LeonardoMuriloGemaqu/Documents/estudos/appcbtmeventos/.codex-worktrees/orq-006/pp071`.
   PR #64 MERGED.
4. `fix/pp-056-event-athlete-links-constraint` — worktree
   `C:/Users/LeonardoMuriloGemaqu/Documents/estudos/appcbtmeventos-pp056`. PR #57 MERGED.

Para cada uma: `git worktree remove <caminho>` e, se a branch local ainda existir após a remoção da
worktree, `git branch -d <branch>` (branch já mergeada, delete seguro, não `-D`).

**Checkout principal** (`C:/Users/LeonardoMuriloGemaqu/Documents/estudos/appcbtmeventos`, branch
`fix/pp-062-backfill-normalizacao-clubes`): confirmado `git diff origin/main HEAD` vazio — a branch está
idêntica ao `main` (PR #60 já mergeado, commit `74e8473`). Após o Bloco 2 ser concluído (ver abaixo),
fazer checkout de volta para `main` e deletar a branch local `fix/pp-062-backfill-normalizacao-clubes`
(`git branch -d`, só depois de confirmar que não há trabalho pendente nela).

**Não tocar** em `fix/pend-cbtm-006-web-audit` (worktree
`C:/Users/LeonardoMuriloGemaqu/Documents/estudos/appcbtmeventos-worktrees/pend-cbtm-006-web-audit`) —
ver Bloco 3 abaixo, é investigação conjunta, não limpeza mecânica.

---

## Bloco 2 — PP-062: CORREÇÃO MATERIAL (2026-10-16) — NÃO rodar `--execute` sem nova decisão de Leo

**O `--execute` já foi rodado em produção em 2026-09-19.** `docs/sessions/2026-09-19-PP058-PP059-PP060-PP062-P0-clubes-duplicados.md`
(linhas 32-50) documenta, com evidência concreta (backup pré-execução no host —
`/tmp/cbtm_pre_pp062_20260919_043601.dump`, run de deploy do worker confirmado rodando o commit mergeado,
verificação SSH read-only pós-execução, confirmação visual de Leo via screenshot, e um teste de estresse
via scrape manual sem recorrência) que Leo executou o backfill diretamente em outra sessão de terminal:
**10 clubes fundidos, 141 atletas mesclados, 57 normalizações aplicadas, `clubs` 73→63, `athletes`
2676→2535**, com 0 clubes duplicados remanescentes confirmado logo depois.

Isso **invalida a instrução original** deste bloco (rodar novo `--execute`). Rodar `--execute` de novo
sem antes confirmar o estado atual do banco arrisca o script tentar fundir clubes que já não são mais
duplicata (podem ter IDs diferentes hoje, relações já reatribuídas) — risco de dano em produção
desnecessário. **Não executar o Passo 2.3 (`--execute`) sem decisão explícita nova de Leo**, informado
deste histórico.

O que falta de fato, com a chave SSH agora disponível (ver atualização no topo deste arquivo):

### Passo 2.0 — Confirmar que o estado pós-19/09 se mantém hoje (verificação, não execução)

Leo pediu para verificarmos o estado real da base de produção antes de qualquer decisão — não confiar só
na tela `/eficiencia` (que é agregada e não deixa óbvio quais pares são duplicata vs. clubes distintos
legítimos). Antes de rodar o script, execute via SSH (`ssh-oracle`, `ssh_exec`) uma query read-only
direta no Postgres de produção que reproduz a MESMA lógica de agrupamento do script
(`discoverCleanupPlan`, `scripts/pp-062-backfill-normalizacao-clubes.ts:47-87`): agrupar clubes pelo nome
sem o sufixo de UF (`CLUB_UF_SUFFIX_PATTERN = /\s*[-(]\s*[a-z]{2}\s*\)?\s*$/i`, `packages/shared/src/index.ts:782`)
e listar grupos com mais de 1 clube.

Query aproximada (ajustar sintaxe ao Postgres real, é só para conferência visual, não substitui o script):

```sql
SELECT
  regexp_replace(lower(trim(name)), '\s*[-(]\s*[a-z]{2}\s*\)?\s*$', '') AS normalized_sem_sufixo,
  count(*) AS qtd_clubes,
  array_agg(id ORDER BY "createdAt", id) AS club_ids,
  array_agg(name ORDER BY "createdAt", id) AS nomes
FROM "Club"
GROUP BY 1
HAVING count(*) > 1
ORDER BY qtd_clubes DESC;
```

(Confirmar o nome exato da tabela/coluna via `\d "Club"` antes de rodar — o nome do model Prisma pode
diferir do nome físico da tabela.) Reportar a saída completa a Claude antes de prosseguir para o Passo
2.1 — isso é a evidência bruta de produção que falta para decidir com segurança, independente do
relatório que o próprio script vai gerar.

### Passo 2.1 — Interpretar o resultado do Passo 2.0 (decisão de caminho, não execução)

- **Se a query 2.0 não retornar nenhum grupo com `qtd_clubes > 1`** (ou retornar só falsos-positivos —
  clubes de nomes realmente distintos que coincidem após strip de sufixo): o estado de 19/09 se mantém,
  não há duplicata ativa hoje. Reportar isso a Claude e **parar aqui** — não rodar `--dry-run` nem
  `--execute`. O Bloco 2 fecha como "sem ação necessária, estado confirmado estável".
- **Se a query 2.0 retornar grupos duplicados novos** (recorrência pós-19/09, apesar da busca tolerante
  em produção): isso é achado novo e relevante — reportar a lista completa a Claude antes de qualquer
  outro passo. Pode indicar que a busca tolerante do `ensureClub` não está cobrindo 100% dos casos, o
  que é uma investigação de causa raiz nova, não um simples "rodar o backfill de novo".

Só prosseguir para o dry-run do script (Passo 2.2) se Claude, após ver o resultado de 2.0, concluir que
há pendência real a investigar.

### Passo 2.2 — Dry-run do script (só se 2.1 indicar necessidade)
```
npx tsx scripts/pp-062-backfill-normalizacao-clubes.ts --dry-run
```
Rodar no container do worker em produção, `DATABASE_URL` nativo do container. Capturar o relatório
completo (contagem de clubes divergentes, pares com `ready`, erros). Confirmar que nenhuma linha foi
escrita. Reportar o relatório completo a Claude.

### Passo 2.3 — `--execute`: BLOQUEADO até nova decisão explícita de Leo
Mesmo que o dry-run do Passo 2.2 mostre pendências reais, **não rodar `--execute`** sem Leo decidir de
novo, agora informado de que o backfill original já rodou em 19/09 com sucesso (0 duplicatas
remanescentes, teste de estresse sem recorrência). Uma nova execução só se justifica se houver
recorrência documentada — e nesse caso a decisão de Leo deve vir com o contexto de que é uma SEGUNDA
rodada, não a primeira.

### Passo 2.4 — Fechar a documentação da entrega (isso sim é necessário, independente do resultado acima)
A Spec `docs/specs/PP-062-backfill-normalizacao-clubes.md` nunca foi commitada em `main` e o
`SESSION_STATE.md` nunca registrou o encerramento da PP-062, apesar do PR #60 estar mergeado e o
backfill real já ter rodado em 19/09. Isso é dívida de documentação, não de código:
1. Commitar a Spec em `main` (ela já está completa localmente, só nunca foi versionada).
2. Atualizar `## HISTÓRICO` da Spec com uma seção final referenciando
   `docs/sessions/2026-09-19-PP058-PP059-PP060-PP062-P0-clubes-duplicados.md` como evidência de
   execução e encerramento, mais o resultado da verificação do Passo 2.0 desta rodada (2026-10-16).
3. Adicionar entrada em `SESSION_STATE.md` — "Índice de sessões encerradas" — para a PP-062, já que ela
   nunca foi registrada lá (hoje só aparece PP-SEC-014 como última entrada, criando a falsa impressão de
   que PP-062 segue em aberto).

**Reportar ao final:** resultado da query 2.0, decisão tomada em 2.1 (parar ou prosseguir), se aplicável
relatório do dry-run 2.2, confirmação de que `--execute` NÃO foi rodado sem nova autorização, e
confirmação dos 3 itens de documentação do Passo 2.4.

---

## Bloco 3 — Investigação conjunta: `pend-cbtm-006-web-audit`

Leo pediu para verificar isto **em conjunto com o Codex**, não decidir sozinho. Worktree:
`C:/Users/LeonardoMuriloGemaqu/Documents/estudos/appcbtmeventos-worktrees/pend-cbtm-006-web-audit`
(branch `fix/pend-cbtm-006-web-audit`, sem PR, sem branch remota).

Estado encontrado: `package-lock.json` modificado, não commitado, não stashed.

Pedido ao Codex: rodar `git diff` nesse arquivo nessa worktree e reportar (a Claude, nesta sessão) o que
mudou — se é resultado de um `npm audit fix`/`npm install` de investigação (relacionado a PEND-CBTM-006,
migração de dependências do `apps/web`, adiada para pós-evento 4TMB26 por decisão de Leo em 2026-09-19)
ou resíduo acidental de outro comando. Não descartar nem commitar ainda — só reportar o diff para decisão
conjunta na próxima interação.
