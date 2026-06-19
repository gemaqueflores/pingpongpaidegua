# PP-018 — Badge "Última atualização" mostra horário de cache, não de scrape, em eventos concluídos

## Skills Codex a ativar
- florestech-implementacao
- security-review-agent: não — mudança é leitura/exibição de timestamp já presente no payload, sem nova superfície de auth, query ou input externo
- e2e-playwright-agent: não — comportamento cobre lógica pura de resolução de data, já teste unitário cobre o contrato
- report-builder-agent: não — não há relatório estruturado de evidências a gerar

## Objetivo
A badge "Última atualização" na página de detalhe do evento deve refletir quando os dados foram efetivamente capturados do CBTM (`lastScrapeAt`). Hoje, para eventos concluídos, ela mostra o horário em que o cache de leitura foi recomputado — que pode ocorrer dias depois do último scrape real, sem que nenhum dado novo tenha sido buscado da fonte.

## Contexto
Investigação em produção (sessão 2026-06-19) confirmou:
- Evento 54 ("Open etapa APTM"): `concluido=true`, `last_scrape_at=2026-06-17 16:13:05`.
- Cache `event-summary` desse evento foi recomputado em `2026-06-19 11:34:05 UTC` (08:34 Brasília) — sem nenhum `scrape_run` novo nesse dia, confirmado por ausência de registros em `scrape_runs` e nos logs do worker.
- O payload do cache contém corretamente `lastScrapeAt: "2026-06-17T16:13:05.600Z"`.
- A UI exibiu "19/06/2026 08:34" — não corresponde a `lastScrapeAt`, corresponde ao timestamp de recomputação do cache.

Não há perda de dados nem corrupção: o dado raspado está correto. O problema é exclusivamente de qual campo a badge prioriza.

## Causa raiz
- Causa imediata: `apps/web/lib/event-published-at.ts:3-4` (`resolveEventPublishedAt`) prioriza `event.publishedAt`, depois `event._meta?.publishedAt`, e só por último `event.lastScrapeAt`. Toda vez que o cache de leitura é recomputado, `withPublishMeta` em `apps/api/src/user/read-model-mirror.ts:114-130` grava `publishedAt: nowIso` no payload — mesmo quando a decisão é `"published_n1"` sem nenhuma mudança de dado proveniente de scrape novo (TTL de cache expirado, qualquer acesso à página dispara recomputação via `resolveEventReadModelCache` em `apps/api/src/user/user.service.ts:6759-6826`).
- Causa sistêmica: `publishedAt` foi desenhado para sinalizar "houve republicação de read model" (uso original: decidir se abas devem recarregar — ver `shouldReloadPublishedTabs` em `event-published-at.ts:7-12`, atualmente sem nenhum consumidor no app). Esse conceito foi reaproveitado para a badge de "última atualização" sem diferenciar recomputação-sem-scrape-novo de scrape-novo-real. Para eventos em andamento, isso é aceitável (recomputação tende a coincidir com scrape novo). Para eventos concluídos, scrape automático já parou (`scrape.processor.ts:348`), então qualquer recomputação de cache por TTL ou acesso à página gera um `publishedAt` divorciado do `lastScrapeAt`.
- Padrão: não há registro de classe episódica prévia sobre esse comportamento — primeira ocorrência documentada.

## Cenários funcionais (DADO/QUANDO/ENTÃO)

**Cenário 1 — evento concluído, cache recomputado sem scrape novo**
DADO um evento com `concluido=true`, `lastScrapeAt="2026-06-17T16:13:05.600Z"` e `publishedAt="2026-06-19T11:34:05.910Z"` (cache recomputado depois do scrape)
QUANDO a página do evento resolve a badge de última atualização
ENTÃO o valor exibido deve ser `2026-06-17T16:13:05.600Z` (lastScrapeAt), não `publishedAt`

**Cenário 2 — evento em andamento (não concluído)**
DADO um evento com `concluido=false`, `publishedAt="2026-06-12T10:00:00.000Z"` e `lastScrapeAt="2026-06-12T09:30:00.000Z"`
QUANDO a página do evento resolve a badge de última atualização
ENTÃO o valor exibido deve continuar sendo `publishedAt` (comportamento atual preservado — necessário para refletir merges parciais de schedule via `mergeSchedulePayload`)

**Cenário 3 — evento concluído sem publishedAt no payload (caso building/primeira carga)**
DADO um evento com `concluido=true`, `publishedAt=null`, `_meta.publishedAt=null`, `lastScrapeAt="2026-06-17T16:13:05.600Z"`
QUANDO a página do evento resolve a badge
ENTÃO o valor exibido deve ser `lastScrapeAt` (comportamento já correto hoje, preservar)

**Cenário 4 — evento concluído sem lastScrapeAt e sem publishedAt**
DADO um evento com `concluido=true`, todos os três campos (`publishedAt`, `_meta.publishedAt`, `lastScrapeAt`) nulos
QUANDO a página do evento resolve a badge
ENTÃO o valor exibido deve ser `null` (badge mostra "-", comportamento já existente em `formatDateTime`)

## Critérios de aceitação
- `resolveEventPublishedAt` recebe o status `concluido` do evento como parâmetro adicional
- Quando `concluido === true`: prioridade passa a ser `lastScrapeAt` → `publishedAt` → `_meta.publishedAt` (lastScrapeAt primeiro)
- Quando `concluido === false` ou `concluido` ausente: comportamento atual preservado (`publishedAt` → `_meta.publishedAt` → `lastScrapeAt`)
- `shouldReloadPublishedTabs` mantém sua assinatura e comportamento atual (não é usada para badge, é sinal de republicação de schedule) — não alterar sua lógica interna, apenas garantir que continue funcionando após a mudança de assinatura de `resolveEventPublishedAt`
- Teste existente `T-C-01` em `event-published-at.test.tsx` continua passando sem modificação de expectativa (ele testa evento não-concluído implicitamente, sem campo `concluido` — deve cair no ramo de comportamento atual)

## Fora de escopo
- Não alterar `withPublishMeta` ou `publishReadModelPayload` no backend — o `publishedAt` do cache continua sendo gravado como está, pois é usado para outras decisões de republicação de schedule
- Não alterar a frequência/política de recomputação de cache (`isReadCacheFresh`, `computeEventCacheMaxAgeMs`) — fora do escopo desta correção, que é puramente de exibição
- Não implementar `shouldReloadPublishedTabs` em nenhuma tela — função já existe sem consumidor, não é objeto desta spec
- Não tratar a divergência de `AUDITORIA_INSCRICOES_DIVERGENCIA` ou outras oportunidades identificadas na sessão 2026-06-16 (3TMB26) — assuntos não relacionados

## Impacto técnico

### Arquivos a modificar
- `apps/web/lib/event-published-at.ts` — alterar `resolveEventPublishedAt` para aceitar `concluido` e mudar a ordem de prioridade condicionalmente
- `apps/web/app/user/events/[id]/page.tsx:305` — atualizar chamada de `resolveEventPublishedAt(event)` para passar `event?.concluido`

### Arquivos que NÃO devem ser tocados
- `apps/api/src/user/read-model-mirror.ts` — lógica de `publishedAt` no cache permanece intacta (usada para schedule merge)
- `apps/api/src/user/user.service.ts` — nenhuma alteração no backend; a correção é puramente de qual campo a UI escolhe exibir
- `apps/web/lib/user-api.ts` — `UserEventRow` já expõe `concluido`, `publishedAt`, `lastScrapeAt`, `_meta` — nenhum campo novo necessário

### DDL / migração
Não aplicável.

### Contrato de API alterado
Não aplicável — nenhum payload de API muda, apenas a função de resolução no frontend.

### Dependências novas
Nenhuma.

## Plano de testes

### Cobertura geral
- camadas obrigatórias: unitário (componente puro `resolveEventPublishedAt`)
- arquivos de teste a criar/modificar: `apps/web/tests/event-published-at.test.tsx`
- fixtures/mocks: objetos `UserEventRow` parciais com combinações de `concluido`/`publishedAt`/`lastScrapeAt`/`_meta.publishedAt`

### T-U-01 — evento concluído prioriza lastScrapeAt sobre publishedAt
Camada: função pura
DADO `{ concluido: true, publishedAt: "2026-06-19T11:34:05.910Z", lastScrapeAt: "2026-06-17T16:13:05.600Z" }`
QUANDO `resolveEventPublishedAt(event)` é chamado
ENTÃO retorna `"2026-06-17T16:13:05.600Z"`

### T-U-02 — evento não concluído mantém prioridade publishedAt (regressão do comportamento atual)
Camada: função pura
DADO `{ concluido: false, publishedAt: "2026-06-12T10:00:00.000Z", lastScrapeAt: "2026-06-12T09:30:00.000Z" }`
QUANDO `resolveEventPublishedAt(event)` é chamado
ENTÃO retorna `"2026-06-12T10:00:00.000Z"`

### T-U-03 — evento concluído sem publishedAt cai em lastScrapeAt (caso já correto, não deve regredir)
Camada: função pura
DADO `{ concluido: true, publishedAt: null, lastScrapeAt: "2026-06-17T16:13:05.600Z" }`
QUANDO `resolveEventPublishedAt(event)` é chamado
ENTÃO retorna `"2026-06-17T16:13:05.600Z"`

### T-U-04 — evento concluído sem nenhum campo retorna null
Camada: função pura
DADO `{ concluido: true, publishedAt: null, lastScrapeAt: null, _meta: { publishedAt: null } }`
QUANDO `resolveEventPublishedAt(event)` é chamado
ENTÃO retorna `null`

### T-U-05 — concluido ausente (undefined) trata como não concluído
Camada: função pura
DADO `{ publishedAt: "2026-06-12T10:00:00.000Z", lastScrapeAt: "2026-06-12T09:30:00.000Z" }` (sem campo `concluido`)
QUANDO `resolveEventPublishedAt(event)` é chamado
ENTÃO retorna `"2026-06-12T10:00:00.000Z"` (mesmo comportamento de T-U-02 — preserva default seguro)

### T-U-06 — evento null retorna null (guard clause existente)
Camada: função pura
DADO `event = null`
QUANDO `resolveEventPublishedAt(event)` é chamado
ENTÃO retorna `null`

### Cobertura de falhas silenciosas
- Não aplicável diretamente (função pura sem efeito colateral) — mas a regressão do teste `T-C-01` original garante que o comportamento de evento não-concluído não foi silenciosamente alterado

### Categorias não aplicáveis
- Formulário/Cadastro, Edição/Atualização, Exclusão, Upload, Autenticação/Autorização, Integração externa: `[não aplicável — mudança restrita a função pura de resolução de timestamp em componente de exibição]`

### Comando para rodar a suite
`npm --prefix apps/web test`
