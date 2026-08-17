# PP-021A — Canonicalização de chave de partida recategorizada (causa raiz H4/H5)

## Status: v5 — aprovada por Leo, pronta para implementação

## Skills Codex a ativar
- florestech-implementacao
- security-review-agent: sim — altera lógica de escrita/reconciliação sobre dado de produção (atualiza
  `matchKey` de linhas produtivas reativamente durante novos scrapes, embora sem saneamento em massa).
- e2e-playwright-agent: não.
- report-builder-agent: sim — reportar quantas migrações de chave e quantas colisões (registradas, não
  resolvidas) ocorreram por categoria.

## Domínio instável

Pipeline de upsert de partidas: "Sem histórico" em `DOMAIN_MATURITY.md`. Atenção redobrada por analogia:
verificar estado pós-operação por leitura real, não por contagem de linhas afetadas do Prisma.

## Errata v4 → v5 (3 precisões editoriais aceitas)

1. **Ordem objetivo vs. estratégia.** O objetivo da v4 dizia "migração acontece antes do stale pruning" —
   impreciso. A ordem correta, já descrita corretamente na estratégia v4 mas não refletida no texto do
   objetivo, é: **planejar e proteger** as variantes envolvidas ANTES do pruning; **executar a migração**
   DEPOIS do pruning (no loop de persistência). Objetivo reescrito abaixo para refletir isso.
2. **Nomenclatura de chaves precisada** — a v4 usava "chave bruta"/"`rawMatchKey`" de forma ambígua
   (poderia ser lido como o hash físico sem prefixo `H`, quando na verdade a migração precisa localizar a
   chave prefixada antiga completa). Três termos agora fixos para o resto desta Spec:
   - **`baseMatchKey`** — o sufixo físico `H` (hash do confronto), produzido pelo parser, sem prefixo.
   - **`rawScopedMatchKey`** — a chave completa antiga, `cat:id:<categoryId-bruto>|H`.
   - **`canonicalMatchKey`** — a chave completa nova, `cat:id:<effectiveCbtmCategoryId>|H`.
3. **Propagação de `categoryId` efetivo, não só da chave.** Verificado em código: `scoreMatchForCategoryPool`
   (`upsert.service.ts:906`) lê `match.categoryId` diretamente, não deriva de `matchKey`. Se a etapa de
   reconciliação antecipada só substituísse `matchKey` por `canonicalMatchKey` sem também atualizar
   `match.categoryId` para `effectiveCbtmCategoryId`, o scoring de dedup continuaria avaliando o pool de
   atletas da categoria de origem bruta — mesmo com a chave já corrigida, o resultado do scoring estaria
   errado. Corrigido: a coleção reconciliada produz um `ParsedMatch` efetivo completo (`categoryId =
   effectiveCbtmCategoryId`, `matchKey = canonicalMatchKey`), com a categoria bruta preservada em campo
   separado só para auditoria/migração (não usado por merge/dedup/scoring).

## Errata v3 → v4 (correção técnica aceita — 4 pontos, mantida da rodada anterior)

Verificação adicional de código nesta rodada confirma todas as 4 alegações do contraponto:

**C1 — ordem real do pipeline: pruning roda ANTES do loop de persistência.** Confirmado:
`keepMatchKeys`/stale pruning stage-3 está nas linhas 1424-1494, e o loop que resolve `existingMatch` e
migraria a chave só começa na linha ~1503 (`for (const parsedMatch of dedupedMatchesFinal.matches)`). A
v3 dizia "migrar durante a persistência" sem perceber que, nessa ordem, o pruning já avaliou e pode ter
apagado a variante histórica **antes** de qualquer migração acontecer — porque no momento do pruning a
linha ainda está sob a chave antiga (`cat:raw|H`), que não bate com `keepMatchKeys` (que contém
`canonicalMatchKey`s), sendo classificada como obsoleta.

**C2 — regras de colisão se sobrepunham.** A v3 não definia precedência entre "chave canônica já existe →
atualiza" e "múltiplas variantes → pula". Quando existe 1 linha canônica + 1 variante histórica
simultaneamente, ambas as regras pareciam aplicar. Corrigido com precedência explícita (ver estratégia
abaixo).

**C3 — gate de "uma query por execução" é falso, dado o código atual.** Confirmado: `prisma.match.findMany`
já é chamado em outros pontos do mesmo `upsert()` (linhas 1386, 1450) e em outros métodos do arquivo
(2751, 3372). Exigir "no máximo uma chamada de `findMany` por execução" geraria teste falso ou exigiria
refatoração fora de escopo. Corrigido: o gate é sobre a consulta **dedicada à descoberta de variantes**
não crescer com o número de partidas do dataset — não sobre o total de `findMany` no arquivo.

**C4 — reconciliação antecipada não deve criar categoria.** Confirmado: `ensureCategory()` já é chamado
para todas as `dataset.categories` na linha 1084-1096, **antes** do merge/dedup — logo `categoriesByCbtmId`/
`categoriesByNormalized` já estão populados quando a etapa de reconciliação antecipada precisar consultá-
los. A etapa de canonicalização deve ser pura leitura desses mapas já preenchidos, sem chamar
`ensureCategory` para entradas que podem ser descartadas pela dedup.

## Objetivo (PP-021A)

Canonicalizar a chave de identidade da partida (`canonicalMatchKey`) antes de merge/dedup/retenção, e
**planejar e proteger** — antes do stale pruning rodar — quais variantes sob `rawScopedMatchKey` precisam
ser migradas ou preservadas, para que a **execução da migração**, feita depois do pruning (no loop de
persistência), nunca opere sobre uma linha que o pruning já apagou por não reconhecê-la como mantida.

## Causa raiz

- **Causa imediata:** `withCategoryScopedMatchKey()` (linha 340) fixa o prefixo usando `categoryId` bruto,
  antes da reconciliação por nome (linhas 1504-1517 na versão atual).
- **Causa sistêmica:** o `matchKey` calculado uma vez é reusado por 6+ etapas do pipeline sem
  revalidação; qualquer correção que não trate a ordem de execução real entre essas etapas (em particular
  pruning vs. persistência) reintroduz risco de apagar dado por engano.
- **Padrão:** candidato a `EPISODIC_MEMORY.md` — "chave de identidade calculada uma vez, reusada por
  múltiplas etapas com ordem de execução que não foi mapeada explicitamente antes de alterar uma delas".

## Estratégia estrutural v4

1. **Reconciliação pura, antes de merge/dedup.** Nova etapa (nome sugerido: `reconcileDatasetCategories`)
   roda logo após remover `withCategoryScopedMatchKey` da linha 1336. Para cada item do dataset bruto,
   calcula `effectiveCbtmCategoryId` (resultado da reconciliação por nome/cbtmId, consultando os mapas
   `categoriesByCbtmId`/`categoriesByNormalized` já populados pela linha 1084-1096 — **sem chamar
   `ensureCategory`**) e produz um **`ParsedMatch` efetivo** com:
   - `categoryId = effectiveCbtmCategoryId` (substitui o bruto — consumido por `scoreMatchForCategoryPool`
     e toda a lógica de dedup/scoring downstream, que devem ver a categoria já reconciliada);
   - `matchKey = canonicalMatchKey` (`cat:id:<effectiveCbtmCategoryId>|baseMatchKey`);
   - campo separado (ex.: `rawScopedMatchKey`) preservando a chave bruta original **apenas** para uso na
     descoberta/migração de variantes históricas (passo 3) — nunca lido por merge/dedup/scoring.

   `ensureCategory()` continua sendo chamado como hoje, mais adiante, apenas para as partidas que
   sobreviverem à dedup (nenhuma mudança nessa parte do fluxo).
2. **Merge e dedup intra-run operam sobre `canonicalMatchKey`** — mesma lógica de agrupamento/scoring
   atual, trocando apenas qual campo alimenta o agrupamento.
3. **Antes do stale pruning (linhas 1424-1494), carregar e indexar as partidas já persistidas do evento
   por `baseMatchKey`** (uma consulta `findMany` dedicada a essa descoberta, escopada por `eventId` —
   distinta das demais consultas `findMany` já existentes no arquivo, que servem outros propósitos).
   Construir um **plano de resolução determinístico** por `baseMatchKey`, seguindo esta precedência
   (resolve C2):
   - **(a) Já existe linha persistida sob `canonicalMatchKey`:** manter/atualizar essa linha; toda linha
     persistida sob algum `rawScopedMatchKey` remanescente com o mesmo `baseMatchKey` é marcada como
     **protegida** (excluída do pruning stage-3 desta execução) e um warning é registrado — não migrada,
     não apagada, tratamento em PP-021B.
   - **(b) Não existe linha sob `canonicalMatchKey`, exatamente 1 linha sob algum `rawScopedMatchKey` com
     o mesmo `baseMatchKey`:** essa linha é marcada para **migração** (`UPDATE matchKey` de
     `rawScopedMatchKey` para `canonicalMatchKey`, mesmo `id`) e também **protegida** do pruning até a
     migração acontecer.
   - **(c) Não existe linha sob `canonicalMatchKey`, 2+ linhas sob `rawScopedMatchKey` diferentes com o
     mesmo `baseMatchKey` (colisão pré-existente):** todas essas linhas são marcadas como **protegidas** do
     pruning; nenhuma migração automática; warning registrado com as `id`s; a escrita da partida recebida
     neste run para esse `baseMatchKey` é pulada.
4. **Stale pruning (linhas 1424-1494) exclui do cálculo de "obsoleto" todo `matchId`/`matchKey` marcado
   como protegido no passo 3** — via novo conjunto `protectedHistoricalMatchIds` (ou `Keys`, conforme mais
   simples de integrar ao `keepMatchKeys` existente), garantindo que nenhuma variante a migrar ou em
   colisão seja apagada antes da migração acontecer.
5. **Migração efetiva acontece no loop de persistência (linha ~1503+), após o pruning já ter rodado com
   as proteções aplicadas** — para os casos do passo 3(b), atualiza `matchKey` da linha protegida; para os
   demais casos (a, c), segue o comportamento normal de update/create já existente.

## Cenários funcionais (DADO/QUANDO/ENTÃO)

**Cenário 1 — reconciliação pura não cria categoria para entrada descartável**
DADO um dataset bruto com uma partida cuja categoria de origem seria eliminada pela dedup intra-run
QUANDO a etapa de reconciliação antecipada processa o dataset
ENTÃO nenhuma chamada a `ensureCategory()` ocorre nessa etapa — apenas leitura dos mapas já populados.

**Cenário 2 — categoria e chave efetivas alimentam merge/dedup/retenção de forma consistente**
DADO um dataset com `categoryId` de origem bruto variável para a mesma partida física
QUANDO processado
ENTÃO merge, dedup, `scoreMatchForCategoryPool` e o plano de resolução do pruning operam todos sobre o
`ParsedMatch` efetivo (`categoryId = effectiveCbtmCategoryId`, `matchKey = canonicalMatchKey`) — nenhuma
dessas etapas lê o `categoryId` bruto ou `rawScopedMatchKey`.

**Cenário 3 — variante única sob rawScopedMatchKey é protegida do pruning e migrada depois**
DADO uma linha existente sob `rawScopedMatchKey` (`cat:id:<bruto>|baseMatchKey`), sem linha existente sob
`canonicalMatchKey`, sem outra linha concorrente para o mesmo `baseMatchKey`
QUANDO o dataset reprocessa essa partida com `canonicalMatchKey` calculada
ENTÃO essa linha é marcada como protegida ANTES do pruning avaliar `keepMatchKeys` (não é apagada), e é
migrada (mesmo `id`, `matchKey` atualizado de `rawScopedMatchKey` para `canonicalMatchKey`,
`scoreSets`/`MatchParticipant` preservados) no loop de persistência subsequente.

**Cenário 4 — chave canônica já existe: atualiza a canônica, preserva a histórica, não migra**
DADO uma linha já sob a chave canônica e uma variante histórica remanescente para o mesmo hash físico
QUANDO o dataset reprocessa essa partida
ENTÃO a linha canônica é atualizada; a variante histórica não é apagada nem migrada nesta execução;
warning registrado.

**Cenário 5 — colisão de múltiplas variantes: todas protegidas, nenhuma migração, escrita pulada**
DADO 2+ linhas já persistidas para o mesmo hash físico, nenhuma sob a chave canônica
QUANDO o dataset reprocessa essa partida
ENTÃO todas as variantes são protegidas do pruning desta execução; nenhuma é migrada/apagada; warning
registrado com as `id`s; a escrita da partida recebida é pulada para esse hash.

**Cenário 6 — número de consultas de descoberta não cresce com o tamanho do dataset**
DADO dois datasets de tamanhos diferentes (ex.: 10 partidas vs. 1000 partidas) para o mesmo evento
QUANDO ambos são processados por execuções separadas de `upsert()`
ENTÃO o número de consultas dedicadas à descoberta de variantes históricas permanece constante (1 por
execução), não proporcional ao número de partidas do dataset.

## Critérios de aceitação

- `withCategoryScopedMatchKey()` deixa de ser aplicada sobre `dataset.matches` bruto na linha 1336;
  reconciliação pura (sem `ensureCategory`) roda antes, produzindo um `ParsedMatch` efetivo com
  `categoryId = effectiveCbtmCategoryId` e `matchKey = canonicalMatchKey`, mais `rawScopedMatchKey`
  preservado em campo separado.
- `scoreMatchForCategoryPool` e toda lógica de dedup/merge leem o `categoryId` **efetivo** (reconciliado),
  nunca o bruto — verificação explícita de que nenhum ponto downstream de merge/dedup/scoring acessa
  `rawScopedMatchKey` ou o `categoryId` de origem não-reconciliado.
- Merge, dedup intra-run e o plano de resolução de variantes usam `canonicalMatchKey` de forma consistente.
- Descoberta de variantes históricas via índice em memória, carregado por uma consulta dedicada por
  execução — não uma consulta por partida.
- Plano de resolução determinístico implementado com a precedência exata: (a) canônica existe → atualiza
  canônica, protege e não migra históricas; (b) sem canônica + 1 variante → protege e migra; (c) sem
  canônica + 2+ variantes → protege todas, não migra, pula escrita.
- Stale pruning exclui explicitamente as variantes protegidas pelo plano de resolução desta execução —
  T-U cobrindo isso é o mais crítico (evita regressão de apagar dado).
- Teste automatizado cobre os 6 cenários acima.
- **Declaração mantida da v3:** PP-021A não é "read-only em produção" — atualiza `matchKey` de linhas
  produtivas reativamente durante processamento normal de novo scrape; não roda correção em lote (isso é
  PP-021B).

## Fora de escopo

- **PP-021B (saneamento em lote do dado já contaminado)** — Spec separada, dry-run + autorização
  destrutiva explícita de Leo antes de qualquer `DELETE` em produção.
- Não alterar `scoreMatchForCategoryPool`.
- Não alterar o parser (`packages/parser`).
- Não determinar previamente o total "correto" de linhas pós-saneamento.
- Não refatorar as demais chamadas a `prisma.match.findMany` já existentes no arquivo (linhas 1386, 1450,
  2751, 3372) — permanecem como estão; a nova consulta de descoberta de variantes é adicional e distinta.

## Impacto técnico

- Arquivos a criar/modificar:
  - `apps/worker/src/pipeline/upsert.service.ts` — remover `withCategoryScopedMatchKey` da linha 1336;
    introduzir reconciliação pura antecipada; ajustar merge/dedup para consumir `canonicalMatchKey`;
    introduzir consulta de descoberta de variantes + plano de resolução determinístico antes do pruning
    (linhas 1424-1494); introduzir `protectedHistoricalMatchIds`/`Keys` consumido pelo cálculo de
    `keepMatchKeys`/staleIds; aplicar migração efetiva no loop de persistência (linha ~1503+) para o caso
    (b) do plano.
  - `apps/worker/test/upsert-dedup.test.ts` (ou equivalente) — novos T-* para os 6 cenários.
- Arquivos que NÃO devem ser tocados:
  - `apps/api/src/user/user.service.ts`.
  - `prisma/schema.prisma`.
  - As demais chamadas `findMany` já existentes fora do escopo desta mudança (linhas 1386, 1450, 2751,
    3372) — não refatorar.
- DDL / migração: nenhuma.
- Contrato de API alterado: nenhum.
- Dependências novas: nenhuma.

## Plano de testes

### Cobertura geral
- camadas obrigatórias: unitário (worker)
- arquivos de teste a criar/estender: `apps/worker/test/upsert-dedup.test.ts` (Codex confirma arquivo)
- fixtures/mocks: datasets sintéticos com `categoryId` bruto variável; fixtures de partidas já persistidas
  cobrindo os 3 casos do plano de resolução (canônica existente, variante única, colisão); spy/mock sobre
  a função de consulta de descoberta de variantes para contar chamadas.

### T-U-01 — Reconciliação antecipada não chama ensureCategory
DADO: dataset com entrada cuja categoria seria eliminada pela dedup
QUANDO: a etapa de reconciliação pura processa o dataset
ENTÃO: nenhuma chamada a `ensureCategory()` ocorre nessa etapa (spy/mock confirma zero chamadas antes do
loop de persistência final).

### T-U-02 — Categoria e chave efetivas propagadas para dedup/scoring (não só a chave)
DADO: partida com `categoryId` bruto `110` cuja reconciliação resolve para `effectiveCbtmCategoryId = 112`,
inserida num grupo de hash repetido junto com outra partida já sob categoria `112`
QUANDO: `scoreMatchForCategoryPool` é chamado para essa partida durante a dedup cross-category
ENTÃO: o pool de atletas consultado é o da categoria `112` (efetiva) — não o da categoria `110` (bruta) —
confirmando que `categoryId` no `ParsedMatch` avaliado já é o efetivo, não o bruto.

### T-U-02B — Canonicalização consistente entre merge/dedup/plano de resolução
DADO: dataset com `categoryId` bruto variável para a mesma partida física
QUANDO: processado
ENTÃO: merge, dedup e o plano de resolução operam sobre a mesma `canonicalMatchKey`.

### T-U-03 — Variante histórica única: protegida do pruning, depois migrada
DADO: linha existente sob chave bruta, sem canônica existente, sem outra variante
QUANDO: dataset reprocessa essa partida
ENTÃO: a linha não é apagada pelo pruning desta execução (verificação de estado real pós-pruning, antes
da migração) e, ao final da execução completa de `upsert()`, está migrada para `canonicalMatchKey` com
mesmo `id` e dados preservados.

### T-U-04 — Chave canônica existente: atualiza canônica, preserva histórica
DADO: linha sob chave canônica + variante histórica remanescente, mesmo hash físico
QUANDO: dataset reprocessa
ENTÃO: canônica atualizada; histórica não apagada nem migrada; warning registrado.

### T-U-05 — Colisão de múltiplas variantes: todas protegidas, nenhuma migração, escrita pulada
DADO: 2+ linhas persistidas para o mesmo hash físico, nenhuma canônica
QUANDO: dataset reprocessa
ENTÃO: nenhuma variante apagada/migrada; warning com `id`s; escrita da partida recebida pulada para esse
hash.

### T-U-06 — Número de consultas de descoberta não cresce com o dataset (regressão de N+1 evitada)
DADO: dois datasets de tamanhos diferentes (10 vs. 1000 partidas) para o mesmo evento, processados em
execuções separadas
QUANDO: `upsert()` roda para cada um
ENTÃO: o número de chamadas à consulta dedicada de descoberta de variantes é o mesmo nas duas execuções
(constante, não proporcional ao tamanho do dataset).

### Cobertura de falhas silenciosas
- Persistência: cada T-* lê o estado real de `matches`/`match_participants` após a operação completa,
  não confia em valor de retorno isolado.
- Ordem de execução: T-U-03 verifica explicitamente o estado **entre** o pruning e a migração (não só o
  estado final), para provar que a proteção realmente previne a exclusão prematura.

### Comando para rodar a suite
`npm test` (comando raiz, já cobre `apps-worker` — conforme confirmado em PP-024).
