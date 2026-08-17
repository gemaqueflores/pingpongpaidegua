# PP-023 — Observabilidade de jobs falhos na fila de scraping (H8)

## Status: v4 — aprovada por Leo, limiar confirmado

## Limiar de jobs falhos que aciona "degraded": 1 (confirmado por Leo)

Fundamento: `defaultJobOptions.attempts = 3` já esgota as tentativas antes de um job chegar a `failed` —
ou seja, cada job em `failed` já representa falha operacional definitiva, não uma tentativa transitória
isolada. Não há razão para exigir um acúmulo adicional antes de sinalizar. O caso real que originou H8 (3
jobs falhos da Copa Belém) já teria disparado esse limiar desde o primeiro job falho.

**Nota de janela de visibilidade:** `removeOnFail: { age: 86400, count: 5000 }` (linha 30-33 de
`createQueue()`) mantém jobs falhos por até 86.400s (~24h) antes de serem removidos automaticamente. Isso
significa que, mesmo após o erro de origem (CBTM) ser resolvido, o estado `"degraded"` pode permanecer
visível por até ~24h após o último job falho — comportamento esperado da configuração atual, não um bug
desta Spec, mas deve ser registrado no relatório de entrega para não gerar alarme falso de "degradação
persistente" quando na verdade é só a janela de retenção do BullMQ.

**Valor a implementar: 1**, configurável via variável de ambiente (não hardcoded) — Codex pode ajustar
posteriormente sem nova Spec caso o volume de sinalização se mostre excessivo em produção.

## Skills Codex a ativar
- florestech-implementacao
- security-review-agent: sim — endpoint `/` (`app.controller.ts`) é público sem guard de autenticação;
  mudança no payload de saúde deve confirmar que não vaza dado sensível (mensagens de erro brutas de jobs
  individuais).
- e2e-playwright-agent: não — não há alteração de UI.
- report-builder-agent: não — relatório de execução simples basta.

## Objetivo

Distinguir, na saúde reportada da fila de scraping (`QueueService`), o estado "operacional, sem acúmulo de
falhas" do estado "operacional, mas com jobs falhos acumulados" — sem, ao mesmo tempo, fazer o mecanismo de
auto-recuperação de conexão (`ensureHealthy()`) tratar esse novo estado como falha de conexão.

## Contexto

`apps/api/src/common/queue.service.ts:15-36` já configura retry com backoff exponencial (`attempts: 3`,
`backoff: { type: "exponential", delay: 5000 }`) — H8 não é ausência de retry. `getHealth()` (linhas
38-67) expõe a contagem de `failed`, mas `status` só alterna para `"error"` em falha de conexão Redis.

No CAT PP-020, 3 jobs falhos da Copa Belém 2026 esgotaram as 3 tentativas com o mesmo erro do lado CBTM
(`GetItemsRangeForLoad`) sem gerar sinal além do log.

**Dois achados adicionais confirmados nesta v2, que mudam a implementação:**

1. `ensureHealthy()` (`queue.service.ts:69-93`) trata **qualquer** `status !== "ok"` como falha de conexão
   e força fechar/recriar a conexão Redis (`this.queue.close()` + `createQueue()`, linhas 76-84). Se
   `getHealth()` passar a retornar `"degraded"` por acúmulo de `failed` (conexão saudável, só há jobs com
   falha de negócio), `ensureHealthy()` fecharia e reabriria uma conexão Redis perfeitamente funcional
   toda vez que for chamada com fila degradada — efeito colateral não desejado, potencialmente
   interrompendo jobs `active` no meio da troca de conexão.
2. `apps/api/src/app.controller.ts:21` tipa `checks.queue.status` como `"ok" | "error"` — união fechada,
   sem `"degraded"`. Adicionar esse valor em `getHealth()` sem atualizar esse tipo quebra a compilação
   (TypeScript) ou, se o tipo for relaxado sem cuidado, silenciosamente reclassifica a fila degradada como
   "ok" ou "error" dependendo de como a lógica da linha 34 (`queueCheck.status === "ok"`) reagir a um
   valor fora da união esperada.

## Cenários funcionais

**Cenário 1 — health reporta degradação por acúmulo de falhas**
DADO que a fila `scrape-event` tem N jobs em `failed`, com N ≥ limiar (ver `[LEO DECIDE]`)
QUANDO `getHealth()` é chamado
ENTÃO `status` retorna `"degraded"`, mantendo a contagem de `failed` no payload.

**Cenário 2 — abaixo do limiar, comportamento atual preservado**
DADO que a fila tem `failed` abaixo do limiar (incluindo zero)
QUANDO `getHealth()` é chamado
ENTÃO `status` permanece `"ok"`.

**Cenário 3 — `ensureHealthy()` não reconecta por causa de "degraded"**
DADO que `getHealth()` retorna `"degraded"` (conexão saudável, jobs falhos acumulados)
QUANDO `ensureHealthy()` é chamado
ENTÃO a conexão Redis **não** é fechada/recriada — `ensureHealthy()` trata `"degraded"` como saudável
para fins de conectividade e **retorna `true` sem reconectar**, reservando o fechamento/recriação apenas
para `"error"` (falha real de conexão). O endpoint público (`GET /`) continua reportando `"degraded"`
normalmente — a diferença é só no comportamento interno de `ensureHealthy()`, não no dado exposto.

**Cenário 4 — endpoint público reflete o novo estado sem quebrar o tipo**
DADO que `getHealth()` retorna `"degraded"`
QUANDO o endpoint `/` (`app.controller.ts`) é consultado
ENTÃO o tipo de retorno de `checks.queue.status` é atualizado para `"ok" | "degraded" | "error"`, e o
`status` geral do payload (linha 34) reflete a degradação sem colapsar `"degraded"` em `"error"`.

## Critérios de aceitação

- `getHealth()` retorna `"degraded"` quando `failed >= limiar` (valor definido por Leo via `[LEO DECIDE]`
  acima), configurável via variável de ambiente, não hardcoded.
- `ensureHealthy()` só dispara fechamento/recriação de conexão para `status === "error"` — `"degraded"` é
  tratado como saudável para fins de gestão de conexão (Cenário 3, T-U-03).
- `app.controller.ts:21` atualizado para `"ok" | "degraded" | "error"`; lógica da linha 34 ajustada para
  refletir os três estados sem perder informação (ex.: `status` geral vira `"degraded"` se `queue` for
  `"degraded"`, mesmo com `database` em `"ok"`).
- Nenhuma mudança em `attempts`/`backoff` de `createQueue()`.
- Resposta de `getHealth()`/endpoint público não inclui stacktrace ou mensagem de erro bruta de jobs
  individuais — apenas contagem agregada (achado de security review confirmado antes do merge).

## Fora de escopo

- Não implementar alerta ativo (e-mail, Slack, push) — Spec separada se priorizada.
- Não investigar/corrigir a causa do erro `GetItemsRangeForLoad` do lado CBTM.
- Não alterar `attempts`/`backoff` já configurados.
- Não criar endpoint novo.

## Impacto técnico

- Arquivos a criar/modificar:
  - `apps/api/src/common/queue.service.ts` — `getHealth()` (linhas 38-67): lógica de limiar e novo valor
    de `status`; `ensureHealthy()` (linhas 69-93): distinguir `"degraded"` de `"error"` antes de decidir
    reconectar.
  - `apps/api/src/app.controller.ts` — tipo de retorno (linha 13-30) e lógica de composição do `status`
    geral (linha 34).
  - Arquivo de configuração de env vars do `apps/api` (Codex localiza convenção existente).
- Arquivos que NÃO devem ser tocados:
  - `createQueue()` / `defaultJobOptions` (linhas 15-36).
  - `enqueueScrape` (linha 95 em diante).
- DDL / migração: nenhuma.
- Contrato de API alterado: sim — `checks.queue.status` ganha `"degraded"`; consumidores externos do
  endpoint `/` que assumem união fechada `"ok" | "error"` podem quebrar — Codex verifica se há consumidor
  conhecido (dashboard, monitor externo) antes de implementar e reporta achado.
- Dependências novas: nenhuma.

## Plano de testes

### Cobertura geral
- camadas obrigatórias: unitário (`QueueService`, `AppController`)
- arquivos de teste a criar/estender: teste unitário de `queue.service.ts` e `app.controller.ts` (Codex
  confirma se já existem arquivos de teste para esses componentes)
- fixtures/mocks: mock de `Queue.getJobCounts()` retornando diferentes valores de `failed`; mock de
  `Queue.close()`/reconstrução para verificar se foi chamado ou não

### T-U-01 — Health reporta "degraded" quando failed atinge o limiar
DADO: `getJobCounts()` mockado retornando `failed = limiar configurado`
QUANDO: `getHealth()` é chamado
ENTÃO: `status === "degraded"`.

### T-U-02 — Health permanece "ok" abaixo do limiar
DADO: `getJobCounts()` mockado retornando `failed = limiar - 1`
QUANDO: `getHealth()` é chamado
ENTÃO: `status === "ok"`.

### T-U-03 — ensureHealthy() não reconecta quando status é "degraded"
DADO: `getHealth()` mockado retornando `status: "degraded"`
QUANDO: `ensureHealthy()` é chamado
ENTÃO: `queue.close()` e `createQueue()` **não** são chamados — conexão existente é preservada.

### T-U-04 — ensureHealthy() reconecta normalmente quando status é "error" (não regressão)
DADO: `getHealth()` mockado retornando `status: "error"` (falha de conexão)
QUANDO: `ensureHealthy()` é chamado
ENTÃO: `queue.close()` e `createQueue()` são chamados — comportamento idêntico ao atual.

### T-U-05 — Endpoint público reflete "degraded" sem quebrar tipo
DADO: `queueService.getHealth()` mockado retornando `status: "degraded"`
QUANDO: `GET /` é chamado
ENTÃO: `checks.queue.status === "degraded"` no payload; `status` geral do response reflete degradação.

### Comando para rodar a suite
`npm --prefix apps/api test` (Codex confirma comando exato conforme padrão do projeto).
