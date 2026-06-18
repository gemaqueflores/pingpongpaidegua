# PP-016 — Rascunho: "Partidas Previstas" deve refletir o formato real de disputa

## Origem
Auditoria das badges do evento 51 (3TMB26) em produção: `totalPartidasPrevistas = 1129` vs
`totalPartidasJogadas = 3350` — discrepância de ~3x. Causa raiz identificada: `computeOfficialCategoryMatchesCount`
(`packages/shared/src/index.ts:321-366`) assume um modelo fixo e teórico de chaveamento (grupos de 3,
classificam 2 por grupo, mata-mata simples sem 3º lugar/repescagem) para qualquer categoria que não seja
"Rating" (`R*`). O evento real claramente jogou um formato com mais partidas do que esse modelo prevê.

## Ambiguidades

### O QUÊ
[RESOLVIDO: a métrica "Partidas Previstas" passa a ser calibrada pela evidência observada quando ela existir:
`totalPartidasPrevistas(categoria) = max(calculoTeoricoAtual, partidasPublicadasDaCategoria)`. Não se tenta
reconstruir o chaveamento exato via `round` (Codex apontou que `round` é incompleto/inconsistente entre
eventos e categorias de duplas têm unidade competitiva diferente — não serve como fonte única). Categorias
Rating mantêm a regra especial já existente (`ratingMatchFormat`) como hoje, sem mudança.]

### COMO — fonte do "formato real"
Hoje existem dois candidatos de fonte de verdade, e nenhum modela o chaveamento por categoria de forma
explícita:

1. **Campos do Event** (`groupBestOfSets`, `eliminationBestOfSets`, `seedCriteria`, `ratingMatchFormat`) —
   existem no schema (`prisma/schema.prisma:62-99`) mas descrevem "melhor de quantos sets", não "tamanho de
   grupo" ou "há repescagem/3º lugar". Não respondem a pergunta de quantas partidas o formato gera.
2. **Dados já capturados por partida** (`Match.phase`, `Match.round` — `GRUPOS`, `RESULTADOS`,
   `ELIMINATORIA`, `INSCRICOES`) — o scraper já grava a fase real de cada partida jogada. Isso permite, para
   categorias **já concluídas**, derivar o formato real observado (quantos grupos, tamanho de cada grupo,
   se houve fase de consolação) a partir do próprio dado, sem precisar de configuração nova.

[RESOLVIDO: opção (a) simplificada — sem reconstrução de chaveamento por `round`. Fonte de verdade é a
contagem de partidas já publicadas por categoria (`publishedByCategoryId`, já calculado em
`loadScopedEventSummaryMetrics`). Não há novo campo de configuração manual. Para cada categoria:
`totalPartidasPrevistasCategoria = max(calculatedMatchesCount, publishedMatchesCount)`. Não precisa de
decisão humana por evento/categoria.]

### ONDE — escopo do recálculo
[RESOLVIDO: mudança de regra geral em `computeCategoryMatchMetrics`/agregação (não é correção pontual do
evento 51) — vale para todos os eventos, passados e futuros, já que é só uma função `max()` sobre dados que
já existem, sem necessidade de migração ou backfill. Categoria sem nenhuma partida publicada: fallback é o
modelo teórico atual (`calculatedMatchesCount`), sem mudança de comportamento — `max(teorico, 0) = teorico`.
Sem necessidade de estado "indisponível/null".]

### Achado técnico adicional (não é ambiguidade, é dado a confirmar com Leo)
`loadScopedEventSummaryMetrics` (`apps/api/src/user/user.service.ts:1226`, `:1318`) filtra partidas
"publicadas" por `phase IN (GRUPOS, RESULTADOS)` — **excluindo `ELIMINATORIA`**. Se o scraper grava
partidas de mata-mata como `phase = ELIMINATORIA` (e não `RESULTADOS`), essas partidas não entram em
`totalPartidasPublicadas` nem em `totalPartidasJogadas`, o que seria uma segunda causa de subcontagem
(em sentido contrário — undercounting de jogadas, não de previstas). Isso precisa ser confirmado com query
real em produção antes de decidir se faz parte deste mesmo PP ou é um achado separado.
[RESOLVIDO: Codex confirmou em produção — zero partidas com `phase = ELIMINATORIA` no evento 51/52/53; há
normalização legada `ELIMINATORIA -> RESULTADOS` e o parser tem `ELIMINATORIA_ENABLED = false`. Confirmado
que este achado é risco legado/latente, não causa da discrepância atual. Fora de escopo do PP-016 — não
tratar aqui.]

### Definição de pronto
[RESOLVIDO: critério objetivo — `totalPartidasPrevistas >= totalPartidasPublicadas` sempre que houver
partidas publicadas (decorre de `max()`), e para o evento 51 especificamente
`totalPartidasPrevistas == totalPartidasPublicadas == 3547` enquanto não houver mudança de fase. Não há
fórmula validada com a CBTM — a calibração é por evidência observada, não por modelo esportivo exato.]

### Proveniência da métrica
[RESOLVIDO — Leo decidiu: incluir agora.] PP-016 inclui o campo `totalPartidasPrevistasFonte: "observada" |
"estimada"` no payload de `getEventSummary` (nível evento — `"observada"` se ao menos uma categoria do
evento teve `publishedMatchesCount > calculatedMatchesCount` aplicado via `max()`; senão `"estimada"`).
Frontend (`apps/web/app/user/events/[id]/page.tsx:626`) exibe indicador textual/tooltip junto à badge
"Partidas Previstas" quando a fonte for `"observada"`, evitando comunicar falsa precisão de modelo teórico
quando, na verdade, o número é calibrado por evidência real.

## Abordagem técnica (resolvida — Rodada 3, com posição do Codex)

Abordagem final: `max(calculatedMatchesCount, publishedMatchesCount)` por categoria, calculado dentro de
`computeCategoryMatchMetrics` (`apps/api/src/user/user.service.ts:743-766`), que já recebe ambos os valores
como input. Não há reconstrução de chaveamento via `round` — Codex descartou essa via como fonte única
porque `round` é incompleto/inconsistente entre eventos e categorias de duplas têm unidade competitiva
diferente de atleta individual.

Mudança pontual:
```
calculatedMatchesCount = max(toNonNegativeInt(input.calculatedMatchesCount), publishedMatchesCount)
```
aplicado antes do retorno de `computeCategoryMatchMetrics`, ou no agregador `aggregateScopedEventSummary`
somando por evento — local exato a confirmar na Spec formal lendo o ponto de agregação correto (categoria
vs evento) para não distorcer quando uma categoria está adiantada e outra atrasada dentro do mesmo evento.

Categorias Rating (`ratingMatchFormat`) seguem com a regra especial existente, sem mudança — o `max()` se
aplica de igual forma (teórico Rating vs publicado), sem necessidade de tratamento separado.

## Hipótese de impacto técnico (atualizada — Rodada 3)

- `apps/api/src/user/user.service.ts` — `computeCategoryMatchMetrics` (linhas 743-766) e/ou
  `loadScopedEventSummaryMetrics` (linhas ~1336-1360, onde `calculatedMatchesCount` é somado por evento):
  aplicar `max(calculatedMatchesCount, publishedMatchesCount)` por categoria antes da agregação por evento.
  Dados de `publishedByCategoryId` já existem nesse fluxo — não precisa de query nova.
- `packages/shared/src/index.ts` — `computeOfficialCategoryMatchesCount` não precisa mudar; o `max()` é
  aplicado depois, sobre o resultado dela.
- Cache de read model: trocar `event-summary-v12` → `event-summary-v13` (Codex confirmou baixo risco —
  recálculo é preguiçoso, sob demanda no próximo GET de cada evento; sem recálculo em massa).
- `ELIMINATORIA`/normalização legada: confirmado fora de escopo deste PP (ver achado técnico resolvido
  acima).
- Sem alteração de schema Prisma.
- Frontend (`apps/web/app/user/events/[id]/page.tsx:626`): adicionar indicador/tooltip junto à badge
  "Partidas Previstas" condicionado a `totalPartidasPrevistasFonte === "observada"`.
- Testes existentes que fixam `event-summary-v12` como nome de cache key precisam de atualização
  (Codex apontou esse risco).
- Contrato de API (`getEventSummary`) ganha campo novo `totalPartidasPrevistasFonte` — aditivo, não quebra
  consumidores existentes que ignoram campos desconhecidos.

## Status do ciclo
Todos os `[PENDENTE]` resolvidos. Decisão `[LEO DECIDE]` (proveniência) resolvida — incluir agora. Draft
pronto para virar Spec formal (florestech-revisao/florestech-spec) após aprovação explícita de Leo.
