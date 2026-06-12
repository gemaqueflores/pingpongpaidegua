# PP-006 — DRAFT — Espelho estável de leitura durante scrape (snapshot N vs. transitório N+1)

> **Status:** rascunho fechado — Rodada 3 do ciclo tripartite (2026-06-12).
> Rodada 2 (Codex) respondida e incorporada. Não é Spec formal. Codex não implementa a partir deste arquivo.
> Pendente apenas: bloco `[LEO DECIDE]` abaixo. Após decisão de Leo + ✅, vira Spec formal.

---

## [LEO DECIDE] — DECIDIDO em 2026-06-12 (fechamento do ciclo)

| # | Decisão | Resolução de Leo |
|---|---|---|
| D1 | Auditoria N→N+1 | Auditoria de scrape em `extractionStats` = observabilidade. **Porém a publicação do espelho passa a ser comparativa e decisória** (ver D3) — motivada por problema real declarado por Leo: falhas intermitentes nos links oficiais fazem runs instáveis (menos completos) descartarem o último estado saudável |
| D2 | `group-simulation` no escopo | **Fora do escopo da PP-006** (evento amanhã; economia de execução) — entrega posterior |
| D3 | Comportamento entre espelhos | **Redefinido por Leo — núcleo da entrega:** avaliar cada espelho comparativamente para declarar regressão ou progressão; decidir entre espelho anterior, espelho atual, ou **combinação** (espelho atual atualiza o que não existia no antigo: confrontos antes placeholders agora definidos, placares antes inexistentes). Para `stage-1-reset` manual permanece a recomendação (a): invalidar + `_meta.building` (reset é destrutivo por intenção — comparador tem bypass) |
| D4 | `EventSyncState`/`EventSyncRun` mortos | **(a)** fora desta entrega; limpeza em chore separado |

> Contexto adicional de Leo no fechamento: runs com captura degradada hoje viram
> `latestReliableRunId` mesmo com status `PARTIAL` (`user.service.ts:6357` inclui PARTIAL),
> invalidando o cache saudável e regredindo o que o usuário vê. A publicação comparativa
> (D3) é a resposta a isso na camada do espelho, sem mexer no upsert.

**Spec formal derivada:** `docs/specs/PP-006-espelho-snapshot-leitura.md`

---

## Problema observado

No evento 51 (https://pingpongpaidegua.vercel.app/events/51), a cada ciclo de atualização
o site "zera e sobe tudo outra vez": listagens esvaziam ou ficam parciais durante o scrape
e repopulam ao final.

## Causa raiz (diagnóstico Rodada 1 — leitura física do código)

**Causa imediata — dupla:**

1. **Escrita não atômica nas tabelas-base.** `apps/worker/src/pipeline/upsert.service.ts`
   executa dezenas de operações sequenciais fora de transação única, incluindo deletes
   destrutivos visíveis a leitores durante o run:
   - dedup de matches persistidos: `matchParticipant.deleteMany` + `match.deleteMany` (linhas ~1398–1421)
   - saneamento stage-3 de jogos obsoletos: deletes por categoria (linhas ~1472–1494)
   - sync de inscrições: `athleteCategory/athleteAlias/athlete.deleteMany` (linhas ~2694–2706, ~4509–4546)
   - limpezas de stage-2 (`clearEventMatchesData`) no `scrape.processor.ts` antes da recarga.
   Um leitor que consulta o banco no meio do run vê o estado "deletado mas ainda não recarregado".

2. **Camada de leitura vaza o estado intermediário.** Dois regimes coexistem em
   `apps/api/src/user/user.service.ts`:
   - **Com read model cache** (`resolveEventReadModelCache`, linha ~6191): `event-summary`,
     `event-efficiency`, `event-medalists`, `athlete-summary`. Porém o cache é descartado quando
     `cached.sourceScrapeRunId !== latestReliableRunId` (run novo terminou) **ou** quando
     `isReadCacheFresh` expira a janela dinâmica — o que pode ocorrer **no meio de um run em
     andamento**, forçando `compute()` sobre tabelas semi-mutadas.
   - **Sem read model cache (leitura ao vivo)**: `listAthletes`, `listClubs`, `listCategories`,
     `listEventSchedule`, `listClubAthletes`, `group-simulation` — apenas TTL HTTP de 20–90s
     (`@PublicCacheTtl`). São o principal canal do sintoma "zerou".

**Causa sistêmica:** o design original previa separação scrape→publicação — os modelos
`EventSyncState`/`EventSyncRun` (`prisma/schema.prisma:383-413`, com `SyncMode INCREMENTAL |
FULL_EVENT_REBUILD`) existem no schema mas **não têm nenhuma referência no código**. A camada de
publicação nunca foi implementada; o read model cache foi adicionado depois como otimização de
performance, não como fronteira de consistência.

---

## O que já existe e conta a favor da viabilidade

| Infra existente | Onde | Papel no espelho |
|---|---|---|
| `ReadModelCache` com `sourceScrapeRunId` | `prisma/schema.prisma:269` | Já é, na prática, o "espelho N" — só falta a política de serving |
| Prewarm pós-scrape via BullMQ (`refresh-read-model-cache`) | `apps/worker/src/main.ts:250-280` | Já materializa N+1 após o run — é o mecanismo de "swap" |
| Fingerprint idempotente + hashes stage-3 por categoria | `scrape.processor.ts:1258-1302` | Detecção de mudança N vs N+1 já existe no nível de payload |
| Regression guardrail + conformance audit | `scrape.processor.ts:1219-1238, 1364+` | Embrião da "auditoria de confronto N vs N+1" pedida |
| Lock de scrape por evento (`scrapeLockedAt`) | `scrape.processor.ts:1029-1042` | Sinal natural de "run N+1 em andamento" para a API |

---

## Opções avaliadas

### Opção A — Transação única por run (MVCC Postgres)
Leitores veriam N até o commit de N+1 (snapshot isolation nativo).
**Descartada:** o upsert tem ~4.700 linhas com retries internos, transações locais e escritas
intercaladas com leituras; uma transação interativa de minutos no Prisma/Postgres traz timeout,
locks e bloat, e rollback total mudaria a semântica do status `PARTIAL`. Custo de reescrita
desproporcional.

### Opção B — Espelho na camada de read model (publish gate) — **RECOMENDADA**
O `ReadModelCache` vira a fronteira de consistência oficial:

1. **Política de serving durante run:** se o evento tem scrape em andamento, a API serve o
   payload cacheado (espelho N) mesmo que stale ou com `sourceScrapeRunId` antigo. `compute()`
   nunca roda durante run ativo.
2. **Cobertura completa:** trazer os endpoints de leitura ao vivo (`listAthletes`, `listClubs`,
   `listCategories`, `listEventSchedule`) para o regime de read model cache.
3. **Swap N→N+1:** ao final do run, o prewarm (já existente) recomputa os payloads; o upsert por
   chave do `ReadModelCache` é atômico por linha — o usuário transita de N para N+1 sem ver o
   intermediário.
4. **Auditoria N vs N+1:** estender o pós-scrape para comparar payload novo vs. cache anterior e
   registrar o diff relevante (placares novos, adversários definidos, partidas removidas) no
   `extractionStats` do run — base para futura UI de "o que mudou".

### Opção C — Versionamento de dataset no banco (espelho literal, staging + swap de geração)
Coluna de geração/versão em todas as tabelas por evento (ou tabelas staging duplicadas), scrape
escreve na geração inativa, ponteiro troca após auditoria.
**Avaliação:** máxima fidelidade à proposta original, mas exige migração de schema em 6+ tabelas,
revisão de todas as unique constraints (versão na chave), filtro de versão em toda query de
leitura e ~2× storage. Os modelos mortos `EventSyncState`/`EventSyncRun` sugerem que esse caminho
já foi desenhado e abandonado. A Opção B entrega o mesmo resultado perceptível ao usuário com
fração do custo. Manter como evolução futura se a B se provar insuficiente.

---

## Veredito de viabilidade (Rodada 1)

**Viável — recomendação: Opção B.** ~70% da infraestrutura necessária já existe
(cache com proveniência de run, prewarm pós-scrape, auditorias de regressão). O trabalho real é:
(1) política de serving durante run, (2) cobertura de cache nos endpoints ao vivo,
(3) auditoria/observabilidade do diff N→N+1.

---

## Ambiguidades — O QUE / COMO / ONDE / Definição de pronto

### B1 — Detecção de "run em andamento" na API
[RESOLVIDO: usar `event.scrapeLockedAt` com janela de stale via `resolveScrapeLockStaleMsFromEnv`
de `@cbtm/shared` (`packages/shared/src/event-situation.ts:569`). Não há duplicação de constante:
a API já usa essa mesma função em `admin-events.service.ts:50` e `health-monitor.service.ts:22`
— verificado por Read na Rodada 3. `scrapeRun.finishedAt = null` foi descartado por ser frágil
quando o worker morre antes de finalizar o run.]

### B2 — Endpoints ao vivo com parâmetros de busca/paginação
[RESOLVIDO: cachear dataset-base completo por evento e filtrar/paginar em memória na API.
Para a escala atual (600+ atletas) o payload é pequeno; cache por variant de query criaria
explosão de chaves e invalidação pior. Requisito técnico declarado pelo Codex e incorporado
como critério de aceitação: o payload cacheado deve ser autossuficiente — conter dados para
reproduzir filtros, contagens e `routeId` estável sem nenhuma volta às tabelas-base durante run.]

### B3 — Evento sem cache prévio (primeiro run / pós stage-1-reset)
[RESOLVIDO: nunca computar parcial durante run ativo — isso oficializaria o sintoma "zera e
sobe". Sem espelho N disponível, servir resposta vazia shape-compatible com
`_meta.building: true` (snapshot indisponível). Impacto frontend: baixo nas listas; o
`event-summary` precisa de tratamento visual mínimo para não parecer evento realmente vazio —
entra no escopo web da Spec. O caso stage-1-reset tem decisão própria em D3 do bloco LEO DECIDE.]

### B4 — Escopo da auditoria N vs N+1
[LEO DECIDE: ver D1 no bloco do topo. Posição técnica conjunta (Claude Rodada 1 + Codex
Rodada 2): começar como observabilidade. Gate de publicação agora arrisca manter N congelado por
falso positivo e conflita com `GUARDRAIL_REGRESSION`/strict quality gate; se Leo quiser gate,
exige critério explícito, override manual e log de motivo.]

### B5 — `group-simulation` e endpoints secundários
[RESOLVIDO parcialmente: `listClubAthletes` ENTRA no escopo — a aba clubes expande esse endpoint
diretamente; deixá-lo fora mantém sintoma residual visível.
`group-simulation`: LEO DECIDE (ver D2 no topo) — custo maior por variantes (`categoryId`,
`registrationScope`, `debug`) e regra de simulação; incluir se o DoD for "nenhuma aba pública
flapa", adiar se o DoD for "abas principais publicadas".]

### B6 — Cobertura do prewarm de athlete-summary
[RESOLVIDO: compute parcial durante run não é aceitável (quebraria a promessa do espelho).
Regra: cache antigo existe → servir cache antigo; cache não existe → `_meta.building`
(mesmo shape do B3). Prewarm de todos os atletas fica FORA da primeira versão — custo/latência
não medidos; o limite atual de 120 (`readModelPrewarmAthleteLimit`) é escolha consciente de
custo e permanece.]

### B7 — Timestamp "Última atualização" no frontend
[RESOLVIDO: entra no escopo. Verificado na Rodada 3: o frontend lê `event.lastScrapeAt` no badge
(`apps/web/app/user/events/[id]/page.tsx:524`) **e o usa como gatilho de reload das abas**
(deps de useEffect nas linhas 276/287/298) — ou seja, hoje o `lastScrapeAt` cru dispara refetch
das listas no meio do run, amplificando o sintoma. A Spec deve trocar a fonte para o timestamp de
publicação do snapshot (`ReadModelCache.updatedAt` exposto no summary como `publishedAt`), tanto
no badge quanto no gatilho de reload.]

### Riscos declarados pelo Codex na Rodada 2 — incorporados como restrições da Spec

- **R1 — Ordem prewarm × lock:** o prewarm roda por HTTP contra a API; com a política B1
  ("run ativo serve N"), o prewarm só materializa N+1 se executar **após** a liberação do lock.
  Hoje a ordem já é processEventJob → enfileira prewarm (`main.ts:250-280`), mas a Spec deve
  declarar isso como invariante testável (T-I), inclusive no caso de lock vazado.
- **R2 — Eventos agregados/canonical:** cache sempre pela chave canônica
  (`resolveEventScope`), inclusive quando o job/prewarm vier de evento filho. Os novos kinds
  seguem o padrão já usado pelo `event-summary` (`scope.canonicalEventId`).
- **R3 — stage-1-reset:** caso destrutivo especial — decisão D3 no bloco LEO DECIDE.
- **R4 — Versionamento de payload por kind:** novos kinds nascem versionados
  (`event-athletes-v1`, `event-clubs-v1`, `event-schedule-v1`, `event-categories-v1`) para
  nunca reaproveitar cache antigo com shape incompatível — padrão já existente
  (`event-summary-v12`).
- **R5 — TTL HTTP/CDN:** o swap N→N+1 ainda pode levar 20–45s para ficar visível por causa do
  `@PublicCacheTtl`/CDN. Não bloqueia a solução; entra como expectativa declarada no
  "Fora de escopo" da Spec.

---

## Hipótese de impacto técnico (atualizada pós-Rodada 2/3)

**Arquivos a modificar:**
- `apps/api/src/user/user.service.ts` — política de serving em `resolveEventReadModelCache`
  (detecção de run ativo via `event.scrapeLockedAt` + `resolveScrapeLockStaleMsFromEnv`, já
  importável de `@cbtm/shared`); migração de `listAthletes`/`listClubs`/`listCategories`/
  `listEventSchedule`/`listClubAthletes` para o regime de cache com kinds versionados (R4),
  payloads autossuficientes (B2), sempre pela chave canônica (R2); exposição de `publishedAt`
  no summary (B7); resposta `_meta.building` quando não há espelho (B3/B6).
- `apps/worker/src/pipeline/read-model-prewarm.service.ts` — prewarm dos novos kinds
  (atletas, clubes, categorias, agenda, atletas-por-clube).
- `apps/worker/src/pipeline/scrape.processor.ts` — auditoria diff N vs N+1 no pós-scrape
  (conforme decisão D1).
- `apps/web/app/user/events/[id]/page.tsx` — B7: badge "Última atualização" e gatilho de
  reload das abas passam de `lastScrapeAt` para `publishedAt`; tratamento visual mínimo de
  `_meta.building` no summary (B3).
- `apps/web/lib/user-api.ts` — tipos: `publishedAt`, `_meta.building`.

**Arquivos que NÃO devem ser tocados:**
- `apps/worker/src/pipeline/upsert.service.ts` — a Opção B não exige tornar o upsert atômico;
  mexer nele é risco sem ganho nesta entrega (confirmado pelo Codex na Rodada 2).
- `apps/worker/src/scraper/*` — captura não muda.
- `EventSyncState`/`EventSyncRun` — conforme decisão D4 (recomendação: intocados nesta entrega).

**DDL/migração:** nenhuma obrigatória (`ReadModelCache` já tem os campos necessários).

**Contrato de API:** sem breaking change; payloads ganham metadados aditivos
(`_meta.building`, `publishedAt`).

**Dependências novas:** nenhuma.

---

## Plano de testes — esqueleto (detalhar na Spec formal)

- T-U: política de serving — run ativo + cache stale → serve cache; run ativo + sem cache → comportamento B3; sem run ativo → fluxo atual.
- T-U: lock vazado (scrapeLockedAt além do stale) não congela o serving indefinidamente.
- T-I: durante upsert simulado (deletes aplicados, recarga pendente), endpoints migrados retornam espelho N íntegro.
- T-I: após prewarm, endpoints servem N+1 e auditoria registra diff esperado.
- T-I: listagem com busca/paginação sobre payload cacheado equivale ao resultado da query ao vivo (paridade).
- T-I: prewarm executa após liberação do lock e materializa N+1 (invariante R1); evento filho aquece a chave canônica (R2).
- T-U: frontend — gatilho de reload usa `publishedAt`, não dispara durante run ativo (B7).
- Falhas silenciosas: leitura pós-swap verificada contra estado persistido do `ReadModelCache`, não contra HTTP 200.
