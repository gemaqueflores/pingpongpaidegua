# Avaliação conjunta Claude/Codex — destino da worktree/branch PP-060

Leo pediu para avaliarmos juntos (não decidir sozinhos) o que fazer com a última worktree pendente da
rodada de limpeza desta semana: `chore/pp-060-saneamento-clubes-duplicados-residuo`
(`estudos/.codex-worktrees/appcbtmeventos-pp060`, commit `1054e7c`).

## O que Claude já verificou

- 3 commits, todos exclusivos (nunca em `origin/main`): `1315505` (test RED), `89908c3` (feat GREEN —
  script de saneamento em dry-run), `1054e7c` (docs — normaliza referências cruzadas em outras 3 Specs).
- PR #58 (dessa branch) está **CLOSED sem merge** no GitHub.
- A própria Spec PP-062 (`## SPEC ATIVA` v3, seção de "Impacto técnico", item "Relação com PP-060")
  documenta a decisão: PP-060 cobria os mesmos 10 pares de clubes com lista fixa (sem a busca tolerante
  em `ensureClub` nem a descoberta dinâmica que PP-062 adicionou); a homologação independente bloqueou
  ❌ o script original da PP-060 por escopo ampliado sem declaração (Q3); Leo decidiu seguir com PP-062
  como sucessora e fechar o PR #58 sem merge — o que já aconteceu.
- `docs/specs/PP-060-saneamento-clubes-duplicados-residuo.md` não existe em `origin/main` (só na
  worktree) — nunca foi commitado lá, nem precisa ser, já que foi superada.
- A fusão real de dados que a PP-060 propunha já foi feita (via PP-062, execução de Leo em 19/09,
  confirmada sem duplicatas na verificação desta semana).

## Pergunta para avaliação conjunta

Não há mais valor técnico vivo nesses 3 commits — o código foi homologado com ❌, o PR foi fechado, e o
problema que resolviam já está sanado por outro caminho. A questão é só de **rastreabilidade**: vale
preservar a branch/worktree como registro histórico de uma tentativa de implementação rejeitada (sinal
útil para a classe de erro "descoberta dinâmica não declarada = desvio Q3", já citada no histórico da
PP-062), ou isso já está suficientemente documentado na Spec PP-062 e nas sessões de 19/09, tornando a
branch redundante?

Pedido ao Codex: antes de responder, conferir se há algo nos 3 commits que **não** está já capturado em
`docs/specs/PP-062-backfill-normalizacao-clubes.md` ou em
`docs/sessions/2026-09-19-PP058-PP059-PP060-PP062-P0-clubes-duplicados.md` (ambos já em `origin/main`).
Se não houver nada exclusivo, a recomendação natural é: remover a worktree e deletar a branch local
(`git worktree remove` + `git branch -D`, já que o PR nunca foi mergeado — delete forçado é apropriado
aqui, diferente das branches já mergeadas da rodada anterior). Se houver algo exclusivo e valioso,
declarar o que é antes de decidir.

Esta é uma avaliação, não uma autorização de execução — nenhuma ação deve ser tomada sobre esta branch
até Leo confirmar o caminho, à luz do que Claude e Codex trouxerem.
