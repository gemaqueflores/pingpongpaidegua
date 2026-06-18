# PP-012 — Resiliência do Pipeline: Jobs Redis e Proteção contra Falhas Silenciosas

**Aprovação Leo:** _pendente_

---

## Objetivo

Eliminar dois gaps de resiliência confirmados pela análise do ciclo de vida do 3TMB26:

1. **Falhas invisíveis**: 11 jobs falharam sem rastro no banco (`attemptsMade` vazio — nunca entraram no `processEventJob`). Para a Copa, com mais eventos simultâneos, falhas invisíveis escalam.
2. **Acúmulo indefinido na fila `failed`**: o zset `bull:scrape-event:failed` cresce para sempre. Mascara falhas reais e não tem limpeza automática.
3. **`GetItemsRangeForLoad` sem proteção**: 4 falhas (2 ERRORs no banco + 2 jobs no Redis) causadas por `window[control]` null no contexto do browser — o CBTM retornou a página mas o JS dos controles DevExpress não inicializou. O código já faz null-check em `paginateCardView` (linha 1008 do `capture.service.ts`), mas a mensagem de erro aponta para um `page.evaluate` diferente — provavelmente em `discoverCategories` ou no loop de paginação quando o controle de paginação (`GetItemsRangeForLoad`) não existe no `window`.

---

## Contexto

**Jobs Redis sem rastro:** BullMQ move um job para `failed` quando o handler do worker lança exceção não tratada. Se o job falha antes de entrar no `processEventJob` (ex.: o worker estava ocupado com outro job e o job ficou stalled, ou o próprio worker crashou durante o dequeue), o `scrapeRun` nunca é criado. O único registro é o `failedReason` no hash Redis — que tem TTL indefinido.

**`removeOnFail` ausente nos `scrape-event`**: os jobs de `refresh-read-model-cache` já têm `removeOnFail: { age: 86400, count: 1000 }`. Os `scrape-event` não têm nenhuma política — ficam indefinidamente no zset `failed`.

**`GetItemsRangeForLoad`**: o erro é `TypeError: Cannot read properties of null (reading 'GetItemsRangeForLoad')` — ocorre em um `page.evaluate` que faz `window[control].GetItemsRangeForLoad(...)` sem verificar se `window[control]` existe. A mensagem real indica que é a paginação DX de listagem de jogos, não o combo de categorias (que já tem null-check). Quando o CBTM serve a página com JS incompleto (timeout de carregamento de script), o controle não existe no `window`.

---

## Causa raiz

**Imediata:**
- `queue.add("scrape-event", ...)` não passa `removeOnFail` → acúmulo ilimitado
- `page.evaluate` em algum ponto do fluxo de paginação chama método em objeto null sem guard clause

**Sistêmica:**
- Sem job periódico de limpeza da fila `failed`, o gap operacional cresce com o produto
- Sem log estruturado dos jobs que falham antes do `processEventJob`, falhas pré-processamento são invisíveis

---

## Cenários funcionais

**DADO** um job `scrape-event` que falha com qualquer erro  
**QUANDO** a falha ocorre  
**ENTÃO** o job é removido do zset `failed` após 30 dias (não acumula indefinidamente)

**DADO** jobs acumulados no zset `bull:scrape-event:failed`  
**QUANDO** o job periódico `cleanup-failed-queue` executa  
**ENTÃO** classifica os `failedReason` por padrão, loga sumário estruturado, e remove jobs com mais de 30 dias

**DADO** o CBTM servindo uma página onde o controle de paginação (`window[control]`) é null  
**QUANDO** `captureLiveBrowser` tenta paginar  
**ENTÃO** o null é detectado antes do acesso ao método, a categoria é registrada como não paginada com warning, e o scrape continua (PARTIAL em vez de ERROR)

---

## Critérios de aceitação

1. `queue.add("scrape-event", ...)` em `main.ts` passa `removeOnFail: { age: 30 * 86400, count: 200 }`
2. Job `cleanup-failed-queue` existe, roda diariamente, loga sumário classificado por `failedReason` antes de limpar
3. Após a primeira execução do job, `zcard bull:scrape-event:failed` = 0 (limpa os 11 históricos)
4. `page.evaluate` que gerava `GetItemsRangeForLoad` tem null-check; falha vira warning em vez de throw
5. Suite verde; hook ativo; encoding ok

---

## Fora de escopo

- Alteração do mecanismo de retry do BullMQ (número de tentativas por job) — isso é PP-013
- Alteração da lógica de scrape HTTP — apenas o path de browser é afetado
- Frontend, API, Prisma schema — sem alterações

---

## Impacto técnico

### Arquivos a modificar

**`apps/worker/src/main.ts`**
- `queue.add("scrape-event", ...)` na linha ~215: adicionar `removeOnFail: { age: 30 * 86400, count: 200 }` nas options
- Adicionar job periódico `cleanup-failed-queue` junto ao bloco do `cleanup-raw-captures` (~linha 75), controlado por env var `FAILED_QUEUE_CLEANUP_ENABLED` (padrão `true`)
- No handler do worker (~linha 251): adicionar branch `job.name === "cleanup-failed-queue"` que chama `cleanupFailedQueue(queue)`
- Adicionar função `cleanupFailedQueue(queue: Queue)` no mesmo arquivo: obtém jobs falhos com `queue.getFailed(0, 500)`, classifica por padrão de `failedReason`, loga sumário estruturado, remove com `job.remove()` os que têm `timestamp < Date.now() - 30 * 86400 * 1000`

**`apps/worker/src/config.ts`**
- Adicionar `failedQueueCleanupEnabled: process.env.FAILED_QUEUE_CLEANUP_ENABLED !== "false"`
- Adicionar `failedQueueCleanupEveryMs: Number(process.env.FAILED_QUEUE_CLEANUP_EVERY_MS ?? "86400000")` (padrão 24h)
- Adicionar `failedQueueRetentionDays: Number(process.env.FAILED_QUEUE_RETENTION_DAYS ?? "30")`

**`apps/worker/src/scraper/capture.service.ts`**
- No método `captureLiveBrowser`, identificar o `page.evaluate` que acessa `window[control].GetItemsRangeForLoad` (ou equivalente) sem null-check
- Adicionar guard: `if (!control || typeof control.GetItemsRangeForLoad !== 'function') return { items: [], total: 0 }` (ou equivalente ao retorno esperado)
- O null já é tratado em `paginateCardView` (linha ~1008) para `GetPageCount`/`GetPageIndex`; aplicar o mesmo padrão defensivo para qualquer `page.evaluate` que acessa métodos do objeto de paginação

### Arquivos que NÃO devem ser tocados

- `apps/worker/src/pipeline/scrape.processor.ts` — nenhuma alteração de lógica de pipeline
- `apps/worker/src/pipeline/upsert.service.ts`
- Qualquer arquivo de `apps/api/` ou `apps/web/`
- Schema Prisma — sem DDL

---

## Plano de testes

### Cobertura geral

- Camadas: unitário (classificação de failedReason + null-check) + integração implícita (removeOnFail verificável via inspeção do código)
- Arquivos de teste a criar: `apps/worker/test/cleanup-failed-queue.test.ts` (se padrão de testes do worker existir) ou verificação via source-inspection
- Verificar padrão de testes existente em `apps/worker/` antes de criar

### T-U-01 — removeOnFail presente em scrape-event

Camada: source-inspection  
DADO: `apps/worker/src/main.ts`  
QUANDO: inspecionado  
ENTÃO: `queue.add("scrape-event", ...)` contém `removeOnFail` com `age` >= 2592000 (30 dias em segundos)

### T-U-02 — cleanup-failed-queue classifica failedReason por padrão

Camada: unitário (função de classificação isolada)  
DADO: array de strings de `failedReason` com os três padrões observados: `GetItemsRangeForLoad`, `browser fallback`, `browserContext.close`  
QUANDO: função de classificação é chamada  
ENTÃO: retorna mapa `{ GetItemsRangeForLoad: N, browser_fallback: M, browser_context_closed: P, other: Q }`

### T-U-03 — cleanup remove apenas jobs com idade > retention

DADO: dois jobs mock — um com `timestamp` > 30 dias atrás, outro recente  
QUANDO: função de limpeza executa  
ENTÃO: apenas o antigo é removido; o recente permanece

### T-U-04 — null-check em GetItemsRangeForLoad não lança exceção

Camada: unitário (mock de `page.evaluate` retornando null para o controle)  
DADO: `page.evaluate` retorna `null` para `window[targetControl]`  
QUANDO: o path de paginação é executado  
ENTÃO: retorna resultado vazio sem lançar exceção; warning é adicionado à lista

### Cobertura de falhas silenciosas

- T-U-01 garante que future jobs não acumulam indefinidamente
- T-U-04 garante que o CBTM servindo JS incompleto vira PARTIAL, não ERROR

### Comando para rodar a suite

```
npm --prefix apps/worker test
```
(confirmar test runner em `apps/worker/package.json` antes de implementar)

---

## Orientação para o Codex

```
## Orientação para o Codex — PP-012

### Spec aprovada
caminho: docs/specs/PP-012-resiliencia-pipeline-redis.md
aprovação Leo: _aguardando_

### Plano de testes (resumo)
IDs: T-U-01, T-U-02, T-U-03, T-U-04
arquivo de teste: verificar padrão existente em apps/worker/ — criar conforme padrão encontrado
comando: npm --prefix apps/worker test

### Contexto
branch base: main (b454f49)
branch a criar: fix/pp-012-resiliencia-pipeline-redis

### Pré-condições
- git config user.email = gemaqueflores@gmail.com
- Sem DDL

### Arquivos a modificar (em ordem de implementação)

1. apps/worker/src/config.ts
   - Adicionar ao objeto de config:
     failedQueueCleanupEnabled: process.env.FAILED_QUEUE_CLEANUP_ENABLED !== "false"
     failedQueueCleanupEveryMs: Number(process.env.FAILED_QUEUE_CLEANUP_EVERY_MS ?? "86400000")
     failedQueueRetentionDays: Number(process.env.FAILED_QUEUE_RETENTION_DAYS ?? "30")

2. apps/worker/src/main.ts
   a. No queue.add("scrape-event") do loop de auto-scrape (~linha 215):
      adicionar às options: removeOnFail: { age: config.failedQueueRetentionDays * 86400, count: 200 }
   b. Adicionar job periódico cleanup-failed-queue após bloco rawCaptureCleanup (~linha 75):
      if (config.failedQueueCleanupEnabled) {
        await queue.add("cleanup-failed-queue", {}, {
          jobId: "cleanup-failed-queue-repeat",
          repeat: { every: config.failedQueueCleanupEveryMs },
          removeOnComplete: { age: 24 * 3600, count: 10 },
        })
      }
   c. No handler do worker: adicionar branch para job.name === "cleanup-failed-queue"
      que chama a nova função cleanupFailedQueue
   d. Implementar função cleanupFailedQueue(queue: Queue):
      - queue.getFailed(0, 500) para obter jobs falhos
      - classificar failedReason por padrão (GetItemsRangeForLoad, browser fallback, browserContext, other)
      - log("info", "Cleanup fila failed", { total, porPadrao, removidos })
      - remover com job.remove() os que têm timestamp < Date.now() - config.failedQueueRetentionDays * 86400 * 1000

3. apps/worker/src/scraper/capture.service.ts
   - Localizar o page.evaluate que lança "Cannot read properties of null (reading 'GetItemsRangeForLoad')"
   - Adicionar null-check: if (!control || typeof control.GetItemsRangeForLoad !== 'function')
     retornar estrutura vazia equivalente ao que o método retornaria com zero itens
   - Adicionar warning: "Controle de paginação indisponível — categoria registrada sem dados de paginação"

### Arquivos que NÃO devem ser tocados
- apps/worker/src/pipeline/ (qualquer arquivo)
- apps/api/, apps/web/, packages/, prisma/

### Ordem de implementação (Red-Green por T-*)
T-U-01: red (source-inspection falha por removeOnFail ausente) → green (adicionar removeOnFail)
T-U-02: red (função de classificação não existe) → green (implementar classificação)
T-U-03: red (função de limpeza não existe) → green (implementar limpeza com age check)
T-U-04: red (null lança exceção) → green (adicionar null-check)

### Validação antes de reportar
- npm --prefix apps/worker test → T-U-01 a T-U-04 verdes
- npm run build --workspace apps-worker → ok (se existir)
- npm run verify:encoding → ok
- Confirmar que após deploy, primeira execução do cleanup-failed-queue zera bull:scrape-event:failed
```
