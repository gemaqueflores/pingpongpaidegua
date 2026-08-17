# PP-025 (draft) — Formato de eliminatória simples para duplas independente de prefixo "R"

## Contexto levantado (Read/Grep executados)

- `isRatingCategoryName()` ([packages/shared/src/index.ts:228-233](../../../packages/shared/src/index.ts#L228-L233)):
  detecta categoria "rating" por regex `/^R[A-Z]/` no nome normalizado. É o único sinal usado por
  `computeOfficialCategoryMatchesCount()` (linha 330) para decidir entre fórmula `n-1` (eliminatória
  direta) e fórmula de grupos/combinatória (linhas 342-365).
- `resolveSortBasis()` ([apps/api/src/user/group-simulator.ts:130-133](../../../apps/api/src/user/group-simulator.ts#L130-L133)):
  mesmo padrão de prefixo (`/^r/i`), usado por `useKnockout` (linha 615) que também exige
  `ratingMatchFormat === "K1"` simultaneamente.
- `OfficialCategoryMatchesOptions` ([packages/shared/src/index.ts:208-212](../../../packages/shared/src/index.ts#L208-L212)):
  hoje só recebe `categoryName`, `eventStartDate`, `ratingMatchFormat` — não recebe nível do evento nem
  qualquer sinal de "é competição de duplas".
- `EventOfficialRules` (`apps/api/src/user/user.service.ts:401-404`): só tem `startDate` e
  `ratingMatchFormat` — sem `nivel`.
- 6 call-sites de `computeOfficialCategoryMatchesCount` em 3 arquivos:
  `apps/worker/src/scraper/live-http-capture.service.ts:165`,
  `apps/worker/src/scraper/capture.service.ts:924`,
  `apps/api/src/user/user.service.ts:1226,1394,2468,2478`.
- `Category` (schema.prisma:182-200): não tem campo próprio de "é duplas" — só `name`, `normalizedName`,
  `cbtmCategoryId`, `eventId`. Nenhum booleano ou enum de modalidade na tabela.
- `EventMerge.categorySuffix` (schema.prisma:101-114): sufixo aplicado ao **nome de exibição** de
  categorias de eventos filhos mesclados (ex.: `" - DUPLAS"`, `" - DUPLA MISTA"`, `" - PARA"`) — é
  metadado do merge, não da categoria em si, e só existe quando o evento é filho de um merge.
- Dado real confirmado no CAT PP-020 (Rodada 6): categorias reais de duplas (eventos 5828/5829) têm nomes
  como `"ABSOLUTO A MAS"`, `"SUB-11 MAS"`, `"DUPLA MISTA - ABSOLUTO A"` — o sufixo `"DUPLA MISTA"` aparece
  como **prefixo** do nome da categoria persistida (não como sufixo de exibição do merge), diferente do
  padrão de `categorySuffix` visto em `EventMerge`.
- Fonte oficial (Manual CBTM 2026, itens 1.9.4.1.7 e 1.9.3.3.5; Circular Belém página 9): toda competição
  de duplas — olímpica e paralímpica — é eliminatória simples direta, sempre, independente de volume de
  inscrições. Regra é do **tipo de competição** (individual vs. duplas), não do nível do evento
  (ESTADUAL/OPEN/COPA) nem do rating dos atletas.

---

## Ambiguidades — O QUE / COMO / ONDE / Definição de pronto

### A — Qual sinal identifica "esta categoria é de duplas" de forma confiável?

O QUÊ: hoje não existe campo estruturado para isso. Candidatos observados no código/dado real:
1. `Event.nivel` — não serve: nível é ESTADUAL/OPEN/COPA/etc., ortogonal a "é duplas".
2. Nome da categoria contém "DUPLA" (ex.: `"DUPLA MISTA - ABSOLUTO A"`, e possivelmente
   `"... - DUPLAS"` para masc/fem) — frágil a variação de escrita/acentuação, mas é o único sinal
   disponível hoje sem mudança de schema.
3. Novo campo estruturado (ex.: `Event.competitionFormat` ou `Category.isDoubles`) — mais robusto, mas é
   mudança de schema/DDL, exige migration e recadastro/preenchimento retroativo.
4. Sinal por `EventMerge.categorySuffix` do evento pai — só cobre eventos que são filhos de merge (como
   5828/5829 são), não cobriria um evento de duplas standalone (sem merge) se existir no futuro.

COMO/ONDE: decisão de modelagem, não só técnica — depende de quão geral a solução precisa ser (só a Copa
Belém, ou todo evento de duplas presente/futuro).
Definição de pronto: sinal escolhido, com cobertura declarada (o que cobre e o que não cobre).

[RESOLVIDO: novo campo estruturado no `Event`, não detecção por nome nem reinterpretação de
`ratingMatchFormat`. Motivo confirmado por dado real: existe evento em produção (interno 44, CBTM 5468,
"2TMB26 (IND/DPL/DPLMISTA)") configurado como `ratingMatchFormat=K1` que **mistura** categorias
individuais não-R e categorias Rating no mesmo `eventId`. `ratingMatchFormat` é campo do `Event`, não da
`Category` — reinterpretar `K1` como "todas as categorias deste evento são duplas" quebraria as categorias
individuais desse evento legado.

Campo novo: `Event.competitionFormat` enum `AUTO | K1`.
- `AUTO` (default): comportamento atual integralmente preservado, inclusive `ratingMatchFormat` seguindo
  válido para categorias com prefixo `R`.
- `K1`: todas as categorias daquele evento usam `n-1`, independente do nome/prefixo.
- Eventos 57/58 (CBTM 5828/5829, duplas da Copa Belém) recebem `K1`.
- Evento 44/5468 (misto, legado) permanece `AUTO` — não é resolvido nesta Spec, fica com o comportamento
  atual, sem regressão.

Escopo consciente: esta Spec resolve o caso de eventos **homogêneos** (só duplas). Eventos que misturam
modalidades no mesmo `eventId` (como 5468) não são tratados — ficam registrados como limitação conhecida,
não como bug desta Spec.]

### B — A correção é retroativa (recalcular categorias já persistidas) ou só prospectiva?

O QUÊ: `computeOfficialCategoryMatchesCount()` é uma função pura, chamada sob demanda (não persiste
resultado) na maioria dos call-sites — mas os warnings/contadores gerados durante o scrape
(`officialMatchesCount` em `capture.service.ts`/`live-http-capture.service.ts`) podem já ter sido
persistidos como `expectedMatches`/warnings incorretos em `scrapeRuns` passados.
COMO: se a função for pura e recalculada a cada leitura (casos em `user.service.ts`), a correção é
automática assim que o código mudar — sem precisar reprocessar dado histórico. Se houver valor persistido
(a confirmar em `capture.service.ts`/`live-http-capture.service.ts`), precisaria de reprocessamento.
ONDE: banco de produção — não determinável só por leitura de código sem confirmar se algum desses
call-sites persiste o resultado ou só usa em memória/warning.
Definição de pronto: declarado explicitamente se há dado já persistido incorreto a corrigir, e se sim,
como.

[RESOLVIDO: é misto — confirmado por leitura direta. Os 2 call-sites do worker
(`capture.service.ts:924`, `live-http-capture.service.ts:165`) geram `officialMatchesCount` que é incluído
em `categoriesDiscoveredAudit`, persistido dentro de `ScrapeRun.extractionStats` via
`prisma.scrapeRun.update` (confirmado em `apps/worker/src/pipeline/scrape.processor.ts:903-911` e
chamadas de update nas linhas 636+/880+) — esse valor alimenta `conformanceAudit`, warnings, status
`PARTIAL/SUCCESS` e o strict quality gate. Os 4 call-sites da API (`user.service.ts`) recalculam sob
demanda (puro), mas os resultados entram nos caches `event-summary-v13`
(confirmado em `user.service.ts:1641`) e `event-medalists-v3`.

Encaminhamento adotado:
1. **Não reescrever `ScrapeRun` histórico** — cada run reflete o código vigente no momento em que rodou;
   reescrever histórico corromperia a rastreabilidade de auditoria.
2. **Bump de cache**: `event-summary-v13 → v14`, `event-medalists-v3 → v4` (mesmo padrão já usado em
   PP-022), garantindo que nenhum payload calculado com a fórmula antiga continue sendo servido.
3. Configurar eventos 57/58 com `competitionFormat = K1` (após o campo existir).
4. **Executar scrape manual controlado de 57/58 após o deploy** — evento já concluído não enfileira scrape
   automaticamente; é preciso disparo manual para gerar uma auditoria (`ScrapeRun`) nova e correta com a
   fórmula `n-1`.
5. Validar que os warnings/`conformanceAudit` do novo `ScrapeRun` usam `n-1`, não a fórmula de grupos.

PP-025 tem, portanto, um passo operacional pós-deploy (scrape manual + bump de cache), mas não mutação
retroativa de `ScrapeRun` histórico.]

### C — O simulador de grupos (`group-simulator.ts`) precisa da mesma correção, ou é escopo separado?

O QUÊ: `useKnockout` no simulador exige `sortBasis === "rating"` (via `resolveSortBasis`, mesmo prefixo
`R`) **e** `ratingMatchFormat === "K1"`. Se o sinal de "é duplas" (item A) for aplicado só em
`computeOfficialCategoryMatchesCount`, o simulador continuaria com o mesmo gate incorreto — mas o
simulador de grupos faz sentido para categoria de duplas? Duplas já são sempre eliminatória direta (sem
grupos), então talvez o simulador nem devesse ser oferecido para essas categorias, tornando o bug do
simulador irrelevante na prática (nunca é chamado para duplas) — ou pode ser chamado incorretamente hoje
e gerar simulação de grupos para uma categoria que nunca terá grupos de verdade.
COMO/ONDE: `apps/api/src/user/group-simulator.ts:130-133,614-615`.
Definição de pronto: declarado se o simulador é ou não acionável para categorias de duplas hoje, e se
precisa da mesma correção do item A.

[RESOLVIDO: simulador entra no escopo. `GET /events/:id/group-simulation` é público e aceita qualquer
`categoryId` — `simulateGroups()` carrega categorias de todos os IDs do evento agregado, e a elegibilidade
hoje considera apenas ciclo de vida do evento, conclusão e existência de grupos oficiais, sem excluir
categorias de duplas. Consequência prática: antes da publicação dos grupos de um evento agregado, as
categorias de duplas poderiam ser simuladas incorretamente como se tivessem fase de grupos. Para a Copa
Belém (já concluída) isso não gera impacto visível agora, mas é defeito real e prospectivo — qualquer
evento futuro de duplas passaria pelo mesmo problema antes da conclusão.

O mesmo sinal `competitionFormat` resolvido no item A deve chegar ao simulador: quando `K1`,
`useKnockout` retorna `true` e o simulador devolve `matchups` (eliminatória direta) com zero grupos,
reaproveitando a lógica de K1 já existente no simulador — sem criar novo modo de exibição.]

---

## Proposta de abordagem técnica (resolvida — todos os PENDENTE fechados)

1. Adicionar `Event.competitionFormat` enum `AUTO | K1` (default `AUTO`) via migration Prisma.
2. `OfficialCategoryMatchesOptions` (`packages/shared/src/index.ts`) ganha novo campo
   `competitionFormat?: "AUTO" | "K1"`. `computeOfficialCategoryMatchesCount` usa `n-1` quando
   `competitionFormat === "K1"`, **antes** de checar `isRatingCategoryName` — não substitui a lógica de
   rating existente, apenas a antecede com prioridade maior quando o evento é `K1` explícito.
3. `useKnockout` no simulador (`group-simulator.ts`) passa a considerar `competitionFormat === "K1"` do
   evento como condição alternativa suficiente (independente de `sortBasis`/prefixo `R`), preservando a
   condição atual (`sortBasis === "rating" && ratingMatchFormat === "K1"`) para os demais casos.
4. Configurar eventos internos 57/58 com `competitionFormat = K1` via endpoint admin (não SQL direto).
5. Bump de cache `event-summary-v13 → v14`, `event-medalists-v3 → v4`.
6. Pós-deploy: disparo manual de scrape para eventos 57/58 (não é automático em evento já concluído),
   gerando novo `ScrapeRun` com `officialMatchesCount`/`conformanceAudit` corretos.
7. Evento 44/5468 (misto) permanece `AUTO`, sem alteração — fora de escopo, registrado como limitação.

## Impacto técnico (confirmado)

- Schema/migration:
  - `prisma/schema.prisma` — novo campo `Event.competitionFormat` (enum `AUTO | K1`, default `AUTO`) +
    migration.
- Tipos e API admin:
  - DTOs de evento (Codex localiza convenção existente) + `admin-events.service.ts` — expor
    `competitionFormat` no create/update de evento.
  - `EventOfficialRules` (`user.service.ts:401-404`) — adicionar `competitionFormat`.
- Backend de leitura:
  - `packages/shared/src/index.ts` — `OfficialCategoryMatchesOptions` + `computeOfficialCategoryMatchesCount`.
  - `apps/api/src/user/group-simulator.ts` — `useKnockout` (linha 615).
  - `apps/api/src/user/user.service.ts` — 4 call-sites (linhas 1226, 1394, 2468, 2478) propagando
    `competitionFormat`; cache keys `event-summary-v13→v14`, `event-medalists-v3→v4`.
- Worker:
  - `apps/worker/src/scraper/capture.service.ts:924`, `apps/worker/src/scraper/live-http-capture.service.ts:165`
    — propagar `competitionFormat` nas opções de captura.
- Frontend admin:
  - Formulário de cadastro/edição de evento (web) — novo campo `competitionFormat`, Codex localiza o
    componente equivalente aos demais campos de configuração de evento já existentes.
- Operação pós-deploy (não é código, é execução):
  - Configurar 57/58 como `K1` via admin.
  - Disparar scrape manual de 57/58.
  - Validar `ScrapeRun` novo com `n-1` nos warnings/`conformanceAudit`.
- Arquivos que NÃO devem ser tocados:
  - Evento 44/CBTM 5468 e qualquer lógica que dependa de `ratingMatchFormat` para categorias com prefixo
    `R` — comportamento `AUTO` preserva 100% do fluxo atual.
  - `ScrapeRun` histórico — nenhuma reescrita retroativa.

## Fora de escopo (proposto)

- Não alterar a regra de detecção de categorias "rating" (`isRatingCategoryName`) para o caso individual —
  ela continua correta para o propósito original (categorias por rating point).
- Não reprocessar eventos além de 5828/5829 nesta Spec, salvo se item B confirmar necessidade e Leo
  autorizar escopo mais amplo.
- Não alterar `EventMerge.categorySuffix` nem sua lógica de aplicação — reaproveitado como está, se
  aplicável ao sinal escolhido no item A.
