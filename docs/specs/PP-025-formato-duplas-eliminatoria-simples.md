# PP-025 — Formato de eliminatória simples para duplas independente de prefixo "R"

## Status: v3 — aprovada por Leo (✅), pronta para implementação após PP-022 integrado em main

Caminho `apps/api/test/group-simulator.test.ts` confirmado como arquivo existente real. Implementação
liberada ao Codex somente após a pré-condição de sequenciamento (PP-022 integrado em `main`) ser
satisfeita — ver seção "Pré-condição de sequenciamento" abaixo.

## Errata v2 → v3 (correção de erro próprio)

**Minha v2 estava errada.** Busquei `invalidateReadModelCaches` só em `apps/api/src/user/user.service.ts`
e, não encontrando, declarei "não existe" — busca incompleta, não verificação real do código. A função
**existe** em `apps/api/src/admin/admin-events.service.ts:979-1005`, chamada após create (linha 162),
update (linha 382) e ao marcar evento como concluído (linha 512). Ela resolve `EventMerge` por
`primaryEventId` OU `secondaryEventId` (linha 991) e roda `readModelCache.deleteMany` (linha 981-985)
para todos os IDs relacionados — atualizar o evento 57 (secundário) invalida ativamente tanto o cache do
57 quanto o do canônico 55.

Duas proteções complementares existem, não uma só:
1. **Invalidação ativa** no update administrativo (`invalidateReadModelCaches`).
2. **Bump de versão de chave** (`v13→v14`, `v3→v4`), proteção adicional contra qualquer cache que
   sobreviva por outro caminho.

T-I-02 dividido em T-I-02a (invalidação ativa) + T-I-02b (versionamento como segunda camada).

## Errata v1 → v2 (correções aceitas nesta rodada anterior, mantidas)

1. Adicionado T-U-08 (frontend admin) — o formulário estava no escopo de arquivos mas sem T-* próprio.
2. Comando de validação final corrigido — `npm test` isolado não cobre `apps-web`. Confirmado por leitura
   de `package.json`: `test:regression:critical` não inclui `apps-web`; existe script pronto `verify:web`
   reaproveitado em vez de listar comandos soltos.
3. T-I-01 dividido em propagação (T-I-01a) + persistência (T-I-01b).
5. Caminhos de arquivo de teste e ordem Red-Green por T-* especificados — nesta v3, substituídos por
   caminhos exatos sem curinga (ver "Ordem de implementação").
6. Operação pós-deploy reclassificada: execução condicionada à autorização explícita de Leo após deploy.

## Domínio instável

Nenhum domínio de `DOMAIN_MATURITY.md` cobre diretamente "cálculo de contagem oficial de partidas" ou
"simulador de grupos" — ambos "Sem histórico". Atenção redobrada por analogia: mudança de schema +
múltiplos consumidores exige verificação cuidadosa de não-regressão em todos os call-sites, não só nos
dois eventos-alvo (57/58).

## Pré-condição de sequenciamento (obrigatória)

**A implementação de PP-025 só pode começar depois que PP-022 estiver integrado** (commit `a549ea8`
mergeado em `main`, não apenas homologado localmente). Ambas tocam `apps/api/src/user/user.service.ts` e
as versões de chave de cache `event-medalists-v*` — implementar em paralelo criaria conflito de merge e
risco de uma Spec sobrescrever o bump de versão de cache da outra. Codex confirma que PP-022 está
integrado em `main` antes de criar a branch de PP-025.

## Skills Codex a ativar
- florestech-implementacao
- security-review-agent: sim — novo campo em endpoint admin (`admin-events.service.ts`), exposto a
  operação de escrita de evento; confirmar que a validação do enum (`AUTO | K1`) rejeita valores fora do
  domínio e que não há escalonamento de permissão pela adição do campo.
- e2e-playwright-agent: não — mudança é backend + formulário admin simples (campo novo em formulário já
  existente), sem fluxo de usuário final novo que justifique e2e dedicado.
- report-builder-agent: sim — relatório de entrega deve documentar explicitamente a operação pós-deploy
  (configurar 57/58 + disparar scrape manual + validar `ScrapeRun` resultante), já que é passo executado
  fora do ciclo automático normal.

## Objetivo

Permitir que um evento seja marcado explicitamente como `competitionFormat = K1` (eliminatória simples
direta, `n-1` partidas), aplicável a todas as suas categorias independente do nome/prefixo, sem afetar
eventos existentes que hoje dependem da detecção por prefixo `R` (`ratingMatchFormat`).

## Contexto

CAT PP-020 (Rodadas 5-6) confirmou, por fonte oficial (Manual CBTM 2026, itens 1.9.4.1.7 e 1.9.3.3.5;
Circular Copa Belém página 9) e por query real em produção, que toda competição de duplas — olímpica e
paralímpica — é sempre eliminatória simples direta, independente de nomenclatura ou volume de inscrições.
Os eventos internos 57/58 (CBTM 5828/5829, duplas da Copa Belém) têm `ratingMatchFormat=RR_K1` e
categorias sem prefixo `R` (`"ABSOLUTO A MAS"`, `"SUB-11 MAS"`, `"DUPLA MISTA - ABSOLUTO A"` etc.) —
mesmo corrigindo `ratingMatchFormat` isoladamente para `K1`, o gate `isRatingCategoryName()`
(`/^R[A-Z]/`) nunca aplicaria a fórmula `n-1` a essas categorias.

## Causa raiz

- **Causa imediata:** `computeOfficialCategoryMatchesCount()` e `useKnockout` (simulador) só aplicam
  eliminatória direta quando o nome da categoria começa com `R` — sinal desenhado para identificar
  categorias por "rating point" (um conceito de ranqueamento), reaproveitado incorretamente como proxy
  para "formato de disputa por duplas", que é um conceito diferente.
- **Causa sistêmica:** não existe, hoje, nenhum campo estruturado no modelo de dados para representar
  "esta competição inteira usa eliminatória simples direta" — a única forma de expressar isso é via
  `ratingMatchFormat`, que é ambíguo porque também governa categorias individuais por rating dentro do
  mesmo evento (confirmado pelo evento legado 44/CBTM 5468, que mistura categorias individuais não-R e
  categorias Rating sob o mesmo `eventId` com `ratingMatchFormat=K1`).
- **Padrão:** candidato a `EPISODIC_MEMORY.md` — "sinal de detecção desenhado para um propósito (rating)
  reaproveitado para outro propósito (formato de disputa) sem campo estruturado dedicado".

## Cenários funcionais (DADO/QUANDO/ENTÃO)

**Cenário 1 — evento K1 aplica n-1 independente do prefixo**
DADO um evento com `competitionFormat = "K1"` e uma categoria cujo nome não começa com `R` (ex.:
`"ABSOLUTO A MAS"`)
QUANDO `computeOfficialCategoryMatchesCount()` é chamado para essa categoria
ENTÃO o resultado é `n-1`, não a fórmula de grupos/combinatória.

**Cenário 2 — evento AUTO preserva 100% do comportamento atual (não regressão)**
DADO um evento com `competitionFormat = "AUTO"` (default, incluindo todos os eventos existentes antes
desta Spec)
QUANDO `computeOfficialCategoryMatchesCount()` é chamado para qualquer categoria desse evento
ENTÃO o resultado é idêntico ao comportamento pré-existente — `isRatingCategoryName`/`ratingMatchFormat`
continuam sendo os únicos sinais avaliados, sem interferência do novo campo.

**Cenário 3 — evento misto legado (5468) não regride**
DADO o evento 44/CBTM 5468 com `ratingMatchFormat = "K1"`, `competitionFormat = "AUTO"` (default, não
alterado por esta Spec), contendo categorias com prefixo `R` e categorias sem prefixo `R` no mesmo evento
QUANDO `computeOfficialCategoryMatchesCount()` é chamado para as categorias sem prefixo `R` desse evento
ENTÃO o resultado permanece a fórmula de grupos/combinatória (comportamento atual preservado) — apenas as
categorias com prefixo `R` usam `n-1`, exatamente como hoje.

**Cenário 4 — simulador de grupos: K1 gera matchups, zero grupos**
DADO uma categoria de um evento com `competitionFormat = "K1"`
QUANDO o endpoint de simulação de grupos é chamado para essa categoria
ENTÃO o simulador retorna `matchups` (estrutura de eliminatória direta) e nenhum grupo — reaproveitando a
mesma estrutura de saída já usada para `sortBasis === "rating" && ratingMatchFormat === "K1"`.

**Cenário 5 — simulador: evento AUTO não regride**
DADO uma categoria de um evento com `competitionFormat = "AUTO"` e prefixo/rating não aplicável
QUANDO o endpoint de simulação de grupos é chamado
ENTÃO o comportamento é idêntico ao atual (grupos simulados normalmente, sem influência do novo campo).

**Cenário 6 — propagação da captura registra auditoria correta**
DADO um evento com `competitionFormat = "K1"` sendo scrapeado
QUANDO `ScrapeProcessor` chama `captureService.capture()` (`scrape.processor.ts:549-557`)
ENTÃO `competitionFormat` é propagado nas opções de captura, e `categoriesDiscoveredAudit` persistido em
`ScrapeRun.extractionStats` reflete `officialMatchesCount = n-1` para as categorias desse evento.

**Cenário 7 — invalidação de cache do agregado**
DADO os eventos 57/58 sendo reconfigurados para `competitionFormat = K1` e re-scrapeados
QUANDO os endpoints de resumo/medalhistas do evento agregado (canonical 55/CBTM 5826) são consultados
após o deploy
ENTÃO a leitura usa as novas chaves de cache (`event-summary-v14`, `event-medalists-v4`), não servindo
payload calculado sob a fórmula antiga — mesmo padrão de prova já usado em PP-022 (T-I-01: cache antigo
comprovadamente ignorado).

## Critérios de aceitação

- `Event.competitionFormat` (enum `AUTO | K1`, default `AUTO`) adicionado via migration Prisma; migration
  **não altera** nenhum evento existente além de aplicar o default `AUTO` — nenhum `UPDATE` retroativo
  embutido na migration.
- `OfficialCategoryMatchesOptions`/`computeOfficialCategoryMatchesCount` aceitam e priorizam
  `competitionFormat === "K1"` antes de avaliar `isRatingCategoryName`.
- `useKnockout` no simulador considera `competitionFormat === "K1"` do evento como condição suficiente,
  preservando a condição atual (`sortBasis === "rating" && ratingMatchFormat === "K1"`) para os demais
  casos.
- `scrape.processor.ts` propaga `competitionFormat` do evento para `captureService.capture()`, no mesmo
  ponto onde `ratingMatchFormat` já é propagado (linha 556).
- Endpoint admin de evento (create/update) aceita e valida `competitionFormat` (enum fechado — valor fora
  de `AUTO | K1` é rejeitado com erro claro, não silenciosamente ignorado).
- Formulário admin web expõe o campo `competitionFormat` na tela de configuração de evento.
- Cache bump: `event-summary-v13 → v14`, `event-medalists-v3 → v4` — proteção complementar à invalidação
  ativa já existente em `invalidateReadModelCaches` (`admin-events.service.ts:979-1005`), que já roda após
  update administrativo de evento e já cobre eventos relacionados via `EventMerge`. O bump não substitui
  essa invalidação, é redundância adicional.
- Nenhuma reescrita de `ScrapeRun` histórico.
- Evento 44/CBTM 5468 permanece com `competitionFormat = AUTO` (não alterado por esta Spec) e seu
  comportamento é coberto por teste de não regressão (Cenário 3).

## Fora de escopo

- Não resolver eventos que misturam modalidades no mesmo `eventId` (como 44/5468) — permanecem `AUTO`,
  registrados como limitação conhecida, não como bug desta Spec.
- Não criar detecção automática de `competitionFormat` por nome de categoria — é campo configurado
  explicitamente por operador admin, não inferido.
- Não alterar `isRatingCategoryName`/`ratingMatchFormat` em si — ambos continuam existindo e funcionando
  como hoje para eventos `AUTO`.
- Não migrar retroativamente dado de `ScrapeRun` — apenas cache é invalidado (bump de versão), histórico
  de auditoria de runs passados permanece intacto.
- Operação pós-deploy (configurar 57/58 + disparar scrape manual) é passo de execução do Codex, não
  código a testar automatizadamente — coberta por checklist manual, não por T-*.

## Impacto técnico

- Arquivos a criar/modificar:
  - `prisma/schema.prisma` — `Event.competitionFormat` enum `AUTO | K1`, default `AUTO`; nova migration.
  - `packages/shared/src/index.ts` — `OfficialCategoryMatchesOptions` (linha 208-212) ganha
    `competitionFormat?: "AUTO" | "K1"`; `computeOfficialCategoryMatchesCount` (linha 321+) prioriza esse
    campo antes de `isRatingCategoryName`.
  - `apps/api/src/user/group-simulator.ts` — `useKnockout` (linha 615) considera `competitionFormat` do
    evento.
  - `apps/api/src/user/user.service.ts` — `EventOfficialRules` (linha 401-404) ganha `competitionFormat`;
    4 call-sites (linhas 1226, 1394, 2468, 2478) propagam o campo; cache keys
    `event-summary-v13→v14` (linha 1641), `event-medalists-v3→v4` (mesma chave já bumpada em PP-022,
    Codex confirma linha atual antes de editar).
  - `apps/worker/src/pipeline/scrape.processor.ts` — linha 549-557, propagar `event.competitionFormat`
    para `captureService.capture()`, mesmo padrão de `ratingMatchFormat` na linha 556.
  - `apps/worker/src/scraper/capture.service.ts:924`, `apps/worker/src/scraper/live-http-capture.service.ts:165`
    — aceitar `competitionFormat` nas opções de captura e propagar para
    `computeOfficialCategoryMatchesCount`.
  - DTOs de evento admin + `admin-events.service.ts` — expor `competitionFormat` no create/update.
  - Formulário admin web — campo novo na tela de configuração de evento (Codex localiza componente
    equivalente aos demais campos já existentes, ex. `ratingMatchFormat`, `seedCriteria`).
- Arquivos que NÃO devem ser tocados:
  - `isRatingCategoryName()`, `resolveSortBasis()` — lógica de detecção por prefixo `R` permanece
    intocada para o caso `AUTO`.
  - Qualquer dado do evento 44/CBTM 5468 — nem `ratingMatchFormat`, nem categorias, nem `ScrapeRun`.
  - `ScrapeRun` histórico de qualquer evento — sem reescrita retroativa.
- DDL/migração: sim — novo enum + coluna em `events`, default `AUTO`, sem `UPDATE` retroativo além do
  preenchimento do default pela própria migration.
- Contrato de API alterado: sim — payload de criação/edição de evento admin ganha campo opcional
  `competitionFormat` (retrocompatível — ausente = `AUTO`, mesmo comportamento de hoje).
- Dependências novas: nenhuma.

## Plano de testes

### Cobertura geral
- camadas obrigatórias: unitário (shared, api, worker), integração (cache do agregado)
- arquivos de teste a criar/estender: teste de `packages/shared` para
  `computeOfficialCategoryMatchesCount`; teste de `group-simulator.ts`; teste de `user.service.ts`
  (cache de summary/medalhistas); teste de `scrape.processor.ts`/`capture.service.ts` (propagação de
  opção); teste de validação do DTO admin.
- fixtures/mocks: evento sintético com `competitionFormat = K1`; evento sintético replicando o padrão do
  44/5468 (`ratingMatchFormat=K1`, `competitionFormat=AUTO`, categorias mistas R/não-R).

### T-U-01 — competitionFormat=K1 aplica n-1 independente do prefixo
Camada: `computeOfficialCategoryMatchesCount` (shared)
DADO: `competitionFormat: "K1"`, categoria `"ABSOLUTO A MAS"` (sem prefixo `R`), `n=4`
QUANDO: a função é chamada
ENTÃO: retorna `3` (`n-1`), não a fórmula de grupos.

### T-U-02 — competitionFormat=AUTO preserva comportamento atual (não regressão)
Camada: mesma função
DADO: `competitionFormat: "AUTO"` (ou ausente), categoria sem prefixo `R`, `n=6`
QUANDO: a função é chamada
ENTÃO: retorna o mesmo valor que o comportamento pré-existente (fórmula de grupos/combinatória) —
comparar contra o cálculo já coberto pelos testes existentes do arquivo.

### T-U-03 — evento misto 5468: categorias não-R preservadas sob AUTO + ratingMatchFormat=K1
Camada: mesma função
DADO: `ratingMatchFormat: "K1"`, `competitionFormat: "AUTO"`, categoria sem prefixo `R` (replicando o
padrão do evento 44/5468), `n=8`
QUANDO: a função é chamada
ENTÃO: resultado é a fórmula de grupos/combinatória (comportamento atual) — `competitionFormat=AUTO` não
faz `ratingMatchFormat=K1` vazar para categorias não-R.

### T-U-04 — evento misto 5468: categorias com prefixo R continuam usando K1 (não regressão)
Camada: mesma função
DADO: `ratingMatchFormat: "K1"`, `competitionFormat: "AUTO"`, categoria com prefixo `R` (ex.:
`"RATING A"`), `n=5`
QUANDO: a função é chamada
ENTÃO: resultado é `n-1` — comportamento atual para categorias rating dentro do evento misto permanece
intacto.

### T-U-05 — simulador: competitionFormat=K1 gera matchups, zero grupos
Camada: `group-simulator.ts` (`useKnockout`)
DADO: evento com `competitionFormat: "K1"`, categoria sem prefixo `R`
QUANDO: `simulateGroups()` é chamado para essa categoria
ENTÃO: retorno contém `matchups` (eliminatória direta), nenhum grupo formado.

### T-U-06 — simulador: competitionFormat=AUTO não regride
Camada: mesma função
DADO: evento com `competitionFormat: "AUTO"`, categoria e condições idênticas a um cenário já coberto
pelos testes existentes do simulador
QUANDO: `simulateGroups()` é chamado
ENTÃO: comportamento idêntico ao já testado antes desta Spec (grupos formados normalmente).

### T-I-01a — propagação de competitionFormat até a captura do worker
Camada: integração (`scrape.processor.ts` → `capture.service.ts`)
DADO: evento com `competitionFormat: "K1"` sendo processado por `ScrapeProcessor`
QUANDO: `captureService.capture()` é invocado
ENTÃO: as opções recebidas (via mock/spy do `captureService`) incluem `competitionFormat: "K1"` — mesma
verificação de propagação já usada para `ratingMatchFormat` nos testes existentes de
`scrape.processor.ts`.

### T-I-01b — persistência da auditoria com contagem correta
Camada: integração (`scrape.processor.ts` → `prisma.scrapeRun.update`)
DADO: captura retornando categorias descobertas com `officialMatchesCount` já calculado como `n-1`
(resultado do Cenário 1/T-U-01, propagado pela captura)
QUANDO: `ScrapeProcessor` persiste o resultado do run
ENTÃO: o payload passado a `prisma.scrapeRun.update` (via mock/spy do Prisma client) contém
`data.extractionStats.capture.categoriesDiscoveredAudit[].officialMatchesCount = n-1` para as categorias
do evento `K1`, **e `conformanceAudit` está presente e reflete a mesma contagem** — no fluxo de sucesso
`conformanceAudit` é parte obrigatória do payload (não condicional), o teste asserta sua presença e
valor, não apenas verifica se existe.

### T-I-02a — atualização admin de 57/58 invalida ativamente o cache do filho e do canônico 55
Camada: integração (`admin-events.service.ts`, `invalidateReadModelCaches`)
DADO: `ReadModelCache` com registros existentes para os eventos internos 55 (canônico) e 57 (filho,
merge via `EventMerge.secondaryEventId = 57, primaryEventId = 55`)
QUANDO: um update administrativo do evento 57 é executado (ex.: configurando `competitionFormat = K1`)
ENTÃO: `invalidateReadModelCaches(57)` é chamado (verificado via spy/mock no update handler);
`resolveRelatedEventIdsForCacheInvalidation(57)` retorna `[57, 55]` (o próprio ID mais o
`primaryEventId`/`secondaryEventId` de cada merge encontrado); `prisma.readModelCache.deleteMany` é
chamado com `eventId: { in: [57, 55] }` — os registros de cache de ambos os eventos são removidos, não
apenas o do evento 57 diretamente atualizado.

### T-I-02b — bump de versão como segunda camada de proteção (não regressão)
Camada: integração (`user.service.ts`, `ReadModelCache`)
DADO: um cenário hipotético em que a invalidação ativa de T-I-02a não tenha alcançado um registro de
cache específico (ex.: leitura concorrente entre a invalidação e uma nova escrita)
QUANDO: os endpoints de resumo/medalhistas são consultados após o deploy desta Spec
ENTÃO: mesmo nesse cenário, a leitura nunca usa as chaves antigas (`event-summary-v13`,
`event-medalists-v3`) — apenas `event-summary-v14`/`event-medalists-v4` são consultadas/persistidas,
mesmo padrão de prova do T-I-01 de PP-022. Esta é proteção redundante e complementar a T-I-02a, não o
único mecanismo.

### T-U-07 — validação de competitionFormat no DTO admin
Camada: `admin-events.service.ts` (ou DTO correspondente)
DADO: payload de criação/edição de evento com `competitionFormat: "INVALIDO"` (fora do enum)
QUANDO: a validação é executada
ENTÃO: erro claro de validação — não é silenciosamente aceito nem convertido para `AUTO`.

### T-U-08 — frontend admin carrega e envia competitionFormat
Camada: componente/formulário de configuração de evento (`apps/web/app/admin/page.tsx` ou componente
extraído, mesmo local onde `ratingMatchFormat`/`seedCriteria` já são tratados)
DADO: um evento existente com `competitionFormat: "K1"` sendo aberto para edição no formulário admin
QUANDO: o formulário carrega os dados do evento
ENTÃO: o campo `competitionFormat` é exibido com o valor `"K1"` pré-selecionado; ao submeter o formulário
sem alterar esse campo, o payload de `update` enviado ao backend inclui `competitionFormat: "K1"` — prova
de round-trip completo (carrega → exibe → envia), não apenas que o campo existe visualmente.

### Cobertura de falhas silenciosas
- Persistência: T-I-01b, T-I-02a e T-I-02b leem o payload/estado real passado ao Prisma/harness de
  cache, não confiam apenas no retorno de função isolada.
- Regra de negócio: T-U-03/T-U-04 cobrem explicitamente a violação potencial (vazamento de K1 para
  categorias erradas do evento misto) além do cumprimento (T-U-01).
- Formulário: T-U-08 verifica carregamento E envio (não só renderização do campo).
- Invalidação de cache: T-I-02a prova o mecanismo ativo real (não apenas o de segurança T-I-02b).

### Ordem de implementação (Red-Green-Refactor por T-*, caminhos exatos)

Codex implementa nesta sequência, um T-* por vez, commits separados por T-*, conforme convenção do
contrato (test red → feat/fix green → refactor opcional):

| Ordem | T-* | Arquivo de teste | Arquivo de produção |
|---|---|---|---|
| 1 | T-U-01, T-U-02, T-U-03, T-U-04 | `packages/shared/test/official-matches.test.ts` | `packages/shared/src/index.ts` |
| 2 | T-U-05, T-U-06 | `apps/api/test/group-simulator.test.ts` | `apps/api/src/user/group-simulator.ts` |
| 3 | T-I-01a, T-I-01b | `apps/worker/test/scrape-processor.competition-format.test.ts` (novo) | `apps/worker/src/pipeline/scrape.processor.ts`, `apps/worker/src/scraper/capture.service.ts`, `apps/worker/src/scraper/live-http-capture.service.ts` |
| 4 | T-I-02a | `apps/api/test/admin-events.competition-format.test.ts` (novo) | `apps/api/src/admin/admin-events.service.ts` |
| 5 | T-I-02b | `apps/api/test/user-service.event-summary-cache.test.ts`, `apps/api/test/user-service.event-medalists-cache.test.ts` | `apps/api/src/user/user.service.ts` |
| 6 | T-U-07 | `apps/api/test/admin-events.competition-format.test.ts` (mesmo arquivo do passo 4 — validação do DTO e invalidação de cache são cenários do mesmo conjunto de testes admin) | DTO de evento admin + `apps/api/src/admin/admin-events.service.ts` |
| 7 | T-U-08 | `apps/web/tests/admin-event-competition-format.test.tsx` (novo) | `apps/web/app/admin/page.tsx` ou componente extraído |
| 0 (antes de tudo) | — | — | `prisma/schema.prisma` + migration — não é T-* de comportamento, é pré-requisito estrutural para os demais; roda antes do T-U-01 |

Caminhos fixados, sem curinga — confirmar antes de criar que `apps/api/test/group-simulator.test.ts` é o
nome real do arquivo de teste já existente para `group-simulator.ts` (se o nome real divergir, Codex usa
o arquivo existente correto e reporta o ajuste no relatório de entrega, sem criar arquivo duplicado).

Concluir cada T-* (red + green, refactor se houver) antes de iniciar o próximo. Migration (passo 0) não
segue ciclo Red-Green — é alteração de schema, validada por `npx prisma migrate dev`/equivalente e pela
suite completa passando depois de gerado o client.

### Operação pós-deploy — condicionada à autorização explícita de Leo (não automática)

Este checklist **não é executado automaticamente pelo Codex ao concluir a implementação de código**. É
uma operação em produção que requer autorização explícita de Leo após o deploy estar em produção e
validado — mesmo padrão de decisão explícita já usado para push/PR em outras Specs deste CAT.

1. Confirmar PP-022 integrado em `main` antes de iniciar a implementação de PP-025 (pré-condição, não
   deste checklist pós-deploy).
2. Deploy de PP-025 em produção.
3. **Aguardar autorização explícita de Leo** para prosseguir com a configuração dos eventos 57/58.
4. Configurar eventos internos 57/58 com `competitionFormat = K1` via endpoint/formulário admin.
5. Disparar scrape manual para 57/58 (evento concluído não enfileira automaticamente).
6. Validar `ScrapeRun` resultante: `categoriesDiscoveredAudit`/`officialMatchesCount` usando `n-1`.
7. Consultar endpoints de resumo/medalhistas do evento agregado (55/5826) e confirmar payload reflete os
   novos números (via cache `v14`/`v4`).
8. Confirmar evento 44/5468 segue reportando os mesmos valores de antes do deploy (checagem rápida,
   amostral).

### Comando para rodar a suite (validação final completa)

Nenhum comando isolado cobre todo o escopo desta Spec (`npm test` sozinho não inclui `apps-web`). Rodar
todos, nesta ordem, antes de declarar pronto:
1. `npm test` — cobre `@cbtm/shared`, `apps-api`, `apps-worker`.
2. `npm run verify:web` — cobre teste + build de `apps-web` (script já existente, equivalente a
   `npm run test --workspace apps-web && npm run build --workspace apps-web`).
3. `npm run build` — build completo do monorepo.
4. `npm run test:regression:critical` — cerca crítica já usada nas demais Specs deste CAT.
5. `npm run verify:encoding`
6. `npm run verify:security`
