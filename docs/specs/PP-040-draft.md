# PP-040 (draft) — Limpeza de RawCapture para os 13 eventos "verde" da auditoria PP-038

## Status: Rodada 3 — resolvido, pronto para virar Spec formal

## Objetivo

Executar a limpeza de `RawCapture` (via mecanismo já existente `RawCaptureRetentionService`/rota admin
`POST /admin/events/:id/raw-captures/cleanup`) apenas para os 13 eventos classificados "verde" pela
auditoria PP-038 — `5219`, `5247`, `5480`, `5707`, `4849`, `5368`, `5468`, `5476`, `5688`, `5827`, `4953`,
`5542` — mais `5680` **se** a investigação de inflação de observações (pendente, tema PP-021) concluir que
não há risco. Os demais 10 eventos (5 vermelho + `5246` + `6013`, 2 amarelo restantes `5826`/`5131`/`5691`,
e `6054` fora da coorte) permanecem intocados até nova decisão de Leo.

## Contexto (confirmado por leitura de código)

- **Mecanismo já existe, sem necessidade de código novo:**
  - `RawCaptureRetentionService.cleanup(input: { eventId?, dryRun? })`
    (`apps/api/src/admin/raw-capture-retention.service.ts:62-192`) já aceita escopo por evento único
    (`input.eventId`) e modo `dryRun` — não deleta nada quando `dryRun: true`, só retorna
    `rawCapturesPrunable`.
  - `AdminEventsService.cleanupRawCaptures()` (`admin-events.service.ts:636-641`) chama o serviço acima,
    validando o evento existe (`ensureEvent`) quando `eventId` é passado.
  - Rota HTTP: `POST /admin/events/:id/raw-captures/cleanup`
    (`admin-events.controller.ts:130-139`), protegida por `JwtAuthGuard` + `RolesGuard("ADMIN")`
    (`admin-events.controller.ts:24-26`) — já requer autenticação de admin, nenhuma mudança de superfície.
  - Existe também rota global `POST /admin/events/raw-captures/cleanup` (linha 122-128, sem `:id`) que
    varre **todos** os eventos — **não deve ser usada nesta Spec**, só a rota por evento.
- **Cron do worker é independente e mais amplo:** `apps/worker/src/main.ts:75-90` agenda
  `cleanup-raw-captures` (job BullMQ) rodando `retention.cleanup({ dryRun: false })` **sem** `eventId` —
  ou seja, se `RAW_CAPTURE_CLEANUP_ENABLED` estiver ativo (default: ativo,
  `apps/worker/src/config.ts:46`), o worker já limpa **todos os eventos elegíveis pela política de
  retenção padrão**, não só os 13 verdes. Isso é uma pré-condição a verificar antes de agir: se esse cron
  já está rodando em produção, alguns dos 13 verdes podem já ter sido parcialmente limpos pela política
  padrão (`successDays=14`), e os vermelhos/amarelos só não foram porque `RAW_CAPTURE_RETENTION_DAYS_ERROR`
  default é `0` (mantém indefinidamente runs `PARTIAL`/`ERROR`).
- **Duas implementações do serviço existem** (achado a esclarecer): uma em
  `apps/api/src/admin/raw-capture-retention.service.ts` (usada pela rota admin), outra em
  `apps/worker/src/pipeline/raw-capture-retention.service.ts` (usada pelo cron do worker) — parecem
  duplicadas com a mesma lógica (`shouldRetainRun`, `toCutoff`). Confirmar com Codex se são de fato
  idênticas ou se divergem, e se isso é dívida técnica a registrar (não corrigir nesta Spec).
- **PP-039 já entregou `cbtm_homolog`** — base local com cópia fiel dos dados estruturados de produção
  (sem `raw_captures`, que foi excluído do dump). **Isso é um problema para esta Spec:** `cbtm_homolog` não
  tem `raw_captures` copiado, então não dá para testar a limpeza real de `RawCapture` contra ela — não há
  dado para limpar.

## Ambiguidades

**O QUE:** ⚠️ Conflito descoberto na leitura: a base de homologação criada pela PP-039 excluiu
propositalmente `raw_captures` (95% do tamanho do dump, sem uso nos testes de PP-037/PP-038 na época). Mas
agora, para testar a limpeza da PP-040 com segurança, precisamos justamente de `raw_captures` populado em
homologação. Duas opções:
  (a) gerar um **novo dump/restore incremental** só de `raw_captures` para os 13 eventos verdes (ou uma
      amostra), complementando `cbtm_homolog` já existente;
  (b) pular o teste em homologação para esta Spec específica e confiar em `dryRun: true` direto contra
      produção (o próprio serviço já suporta modo seco sem deletar nada) como validação suficiente antes do
      `dryRun: false` real.

**COMO:** se (a): dump incremental de `raw_captures` filtrado por `event_id IN (13 ids)`, via `pg_dump
--table=public.raw_captures` ou `COPY (SELECT ... WHERE event_id IN (...)) TO STDOUT` + `COPY ... FROM
STDIN` no lado local — mais simples que dump completo pois é tabela única.
**ONDE:** mesma infraestrutura de PP-039 (`cbtm_homolog` complementado, ou produção direto com dry-run).
**Definição de pronto:** para cada um dos 13 eventos: `dryRun: true` executado e resultado
(`rawCapturesPrunable`) registrado e revisado por Leo **antes** de qualquer `dryRun: false`; execução real
só após aprovação explícita por evento (ou em lote, se Leo autorizar todos de uma vez).

[RESOLVIDO: opção (a) — Leo decidiu complementar `cbtm_homolog` com um dump incremental de `raw_captures`
filtrado pelos 13 eventos verdes, antes de qualquer execução real (`dryRun: false`) em produção. Ordem de
execução: 1) dump incremental de `raw_captures` (`event_id IN (13 ids)`) da VM para `cbtm_homolog`; 2)
`dryRun: true` contra `cbtm_homolog` nos 13 eventos, registrar `rawCapturesPrunable`; 3) `dryRun: false`
contra `cbtm_homolog`, confirmar `rawCapturesDeleted` e que as demais tabelas não foram tocadas; 4) só após
Leo revisar o resultado do teste local, repetir passo 2-3 contra produção.]

[RESOLVIDO: cron ativo em produção (`RAW_CAPTURE_CLEANUP_ENABLED` sem override = default `true`). Última
execução `2026-08-27T00:00:00.376Z`: `dryRun=false`, `eventsProcessed=23`, `runsPruned=122`,
`rawCapturesDeleted=0`, `rawCapturesPrunable=0` — o cron já roda, mas com a política padrão
(`RAW_CAPTURE_RETENTION_DAYS_ERROR=0`) não apaga nada de `PARTIAL`/`ERROR`.

Estado atual dos 13 eventos verdes (confirmado por leitura real, `cbtm_event_id` → `events.id` interno):

| CBTM ID | events.id | raw_captures |
|---:|---:|---:|
| 4849 | 26 | 348 |
| 4953 | 29 | 1.182 |
| 5219 | 38 | 43 |
| 5247 | 39 | 31 |
| 5368 | 43 | 717 |
| 5468 | 44 | 55.162 |
| 5476 | 45 | 6.419 |
| 5480 | 49 | 8.901 |
| 5542 | 50 | 9.886 |
| 5680 | 51 | 114.987 |
| 5688 | 52 | 18.869 |
| 5707 | 54 | 36 |
| 5827 | 56 | 9.857 |

Total 226.438 — 226.319 de runs `PARTIAL`, 119 de runs `ERROR` (evento 5476), 0 de `SUCCESS`, 0 sem
`scrapeRunId`. **Achado crítico: com a política padrão atual, `rawCapturesPrunable=0` para todos — a Spec,
como desenhada originalmente (só chamar a rota existente), não teria nenhum efeito.** Necessário decidir
política de retenção para `PARTIAL`/`ERROR` antes de a limpeza ter qualquer efeito real (ver ambiguidade
nova abaixo).

**Nota:** os IDs usados nas tabelas de auditoria PP-038 e neste rascunho até aqui são `cbtm_event_id`
(identificador da fonte oficial), não `events.id` (chave primária interna). `raw_captures.event_id` e a
rota `POST /admin/events/:id/raw-captures/cleanup` usam `events.id` interno. Toda execução desta Spec deve
usar a coluna `events.id` da tabela acima, não o `cbtm_event_id` diretamente — usar o CBTM ID causaria
"Evento não encontrado".]

[RESOLVIDO: as duas implementações de `RawCaptureRetentionService` (api vs. worker) não são idênticas —
divergem em como leem config (API valida `process.env` com fallback para não-finito; worker usa `config`
com `Number(...)` sem o mesmo fallback), em injeção (API usa `PrismaService`; worker usa singleton
`prisma`), no retorno (API inclui `retentionPolicy`; worker não) e em cobertura de teste (só os helpers do
worker têm teste unitário direto). Com defaults válidos, ambas tomam a mesma decisão; com env inválido,
podem divergir. Fonte de verdade para esta Spec: implementação da API
(`apps/api/src/admin/raw-capture-retention.service.ts`), pois a execução usa a rota admin. Duplicação
registrada como dívida técnica/risco de drift — sem correção nesta Spec (fora de escopo, ver abaixo).]

## Ambiguidade nova — política de retenção para viabilizar a limpeza

**O QUE:** o DTO/rota atual (`RawCaptureCleanupDto`, `raw-capture-cleanup.dto.ts`) só aceita `eventId` e
`dryRun` — não existe parâmetro para sobrepor `errorDays` por chamada.
`RawCaptureRetentionService.cleanup()` lê `process.env.RAW_CAPTURE_RETENTION_DAYS_ERROR` direto no corpo
do método (linha 79), não como argumento de `input`. Portanto a opção de "aplicar prazo maior só para os
13 verdes, sem mudar a env var global do worker" **exige uma pequena extensão de código** — não é operação
pura como assumido na Rodada 1.
**COMO (decisão de Leo já tomada):** estender `CleanupInput`/`RawCaptureCleanupDto` com um campo opcional
(ex.: `errorDaysOverride?: number`) que, quando presente, substitui `process.env.RAW_CAPTURE_RETENTION_DAYS_ERROR`
só naquela chamada — sem tocar a env var do worker/cron (que continua rodando com a política padrão
`errorDays=0` para todos os outros eventos). Restrito à rota por evento (`:id/raw-captures/cleanup`), não à
rota global.
**ONDE:** `apps/api/src/admin/raw-capture-retention.service.ts` (`cleanup()`, linha ~79),
`apps/api/src/admin/dto/raw-capture-cleanup.dto.ts` (novo campo opcional validado), possivelmente
`admin-events.service.ts`/`admin-events.controller.ts` (repassar o campo do body ao `input`).
**Definição de pronto:** chamada com `errorDaysOverride` aplicando corretamente só na execução daquela
chamada; sem `errorDaysOverride`, comportamento idêntico ao atual (regressão zero); cron do worker
inalterado.

[RESOLVIDO: `errorDaysOverride = 7`. Cutoff calculado a partir de `startedAt` do run (mesma lógica de
`toCutoff()`, linha 27-32) — runs `PARTIAL`/`ERROR` dos 13 eventos verdes com `startedAt` há mais de 7 dias
tornam-se elegíveis; runs mais recentes que isso continuam retidos até completar os 7 dias, mesmo dentro
desta execução pontual. Mantém margem de segurança para os eventos aprovados, sem exigir ação futura
repetida (basta rodar de novo depois que os runs recentes envelhecerem, se Leo quiser).]

## Hipótese de impacto técnico

- Nenhuma alteração de código nesta Spec — mecanismo já existe. Execução é chamada HTTP (`curl`/script)
  contra a rota admin já protegida, por evento, começando sempre por `dryRun: true`, primeiro em
  `cbtm_homolog` e só depois em produção.
- Dump incremental de `raw_captures` (só os 13 eventos verdes) da VM para `cbtm_homolog` — operação, não
  arquivo de produção do repositório, mesmo padrão de PP-039.
- Nenhuma DDL, nenhuma mudança de contrato de API (rota já existe e já está documentada no controller).

## Fora de escopo

- Não tocar nos 10 eventos fora do grupo "verde" (5 vermelho + `5246` + `6013`, 3 amarelo, `6054`) nesta
  Spec.
- Não alterar `RAW_CAPTURE_RETENTION_DAYS_ERROR` nem outras variáveis de ambiente do cron do worker nesta
  Spec — se o achado do PENDENTE 2 revelar necessidade de ajuste, isso é Spec separada (a lacuna já estava
  mapeada desde PP-038/PP-036).
- Não usar a rota global `POST /admin/events/raw-captures/cleanup` (sem `:id`) — só a rota por evento.
- Não decidir sobre `5680` nesta Spec — fica de fora até a investigação de inflação (PP-021-relacionada)
  concluir.
