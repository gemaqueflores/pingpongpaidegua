# PP-040 — Limpeza de RawCapture para os eventos "verde" da auditoria PP-038

## Skills Codex a ativar
- florestech-implementacao
- security-review-agent: sim — endpoint admin existente (`POST /admin/events/:id/raw-captures/cleanup`)
  recebe novo campo opcional no body (`errorDaysOverride`); embora a rota já exija `ADMIN` autenticado,
  qualquer campo novo aceito de input externo deve ser validado (tipo, faixa) antes de influenciar uma
  operação destrutiva (`DELETE`).
- e2e-playwright-agent: não — sem UI, operação via API/script administrativo.
- report-builder-agent: não.

## Objetivo

Executar a limpeza de `RawCapture` (via mecanismo já existente `RawCaptureRetentionService`/rota admin
`POST /admin/events/:id/raw-captures/cleanup`) apenas para os 12 eventos classificados "verde" pela
auditoria PP-038 com investigação já concluída — `4849`, `4953`, `5219`, `5247`, `5368`, `5468`, `5476`,
`5480`, `5542`, `5688`, `5707`, `5827` (`cbtm_event_id`). **`5680` fica fora desta execução** — está
classificado "verde" pelo critério técnico de completude, mas tem investigação própria pendente (inflação
de observações, tema relacionado a PP-021) que ainda não concluiu; incluí-lo aqui contradiria o próprio
objetivo da Spec de só agir sobre o que já está confirmado seguro. Os demais 10 eventos (5 vermelho + rows
`5246`/`6013`, 3 amarelo, `6054` fora da coorte) permanecem intocados até nova decisão de Leo.

## Contexto

Ciclo tripartite `docs/specs/PP-040-draft.md` (Rodadas 1-3, fechado). Auditoria de completude
`docs/specs/PP-038-auditoria-completude-pre-limpeza-raw-captures.md` já classificou os 23 eventos; base de
homologação `cbtm_homolog` já existe (`docs/specs/PP-039-copia-producao-homologacao.md`, homologada ✅),
mas **sem `raw_captures`** — precisa de complemento incremental para esta Spec.

**Mecanismo de limpeza já existe, sem necessidade de reescrita:**
- `RawCaptureRetentionService.cleanup(input: { eventId?, dryRun? })`
  (`apps/api/src/admin/raw-capture-retention.service.ts:62-192`) aceita escopo por evento único e modo
  `dryRun` (não deleta quando `true`, só retorna `rawCapturesPrunable`).
- `AdminEventsService.cleanupRawCaptures()` (`admin-events.service.ts:636-641`) valida o evento existe
  antes de chamar o serviço.
- Rota `POST /admin/events/:id/raw-captures/cleanup` (`admin-events.controller.ts:130-139`), protegida por
  `JwtAuthGuard` + `RolesGuard("ADMIN")` — autenticação já exigida, sem mudança de superfície de acesso.
- Existe rota global `POST /admin/events/raw-captures/cleanup` (sem `:id`) que varre todos os eventos —
  **não usar nesta Spec**, só a rota por evento.

**Cron do worker já roda em produção** (`apps/worker/src/main.ts:75-90`, `RAW_CAPTURE_CLEANUP_ENABLED`
default `true`) chamando `retention.cleanup({ dryRun: false })` sem `eventId` — varre todos os eventos pela
política padrão. Última execução confirmada (`2026-08-27T00:00:00.376Z`): `eventsProcessed=23`,
`runsPruned=122`, `rawCapturesDeleted=0`, `rawCapturesPrunable=0` — o cron roda, mas
`RAW_CAPTURE_RETENTION_DAYS_ERROR=0` mantém `PARTIAL`/`ERROR` indefinidamente, então nunca apagou nada
desses eventos.

**Estado atual confirmado dos 12 eventos verdes** (`cbtm_event_id` → `events.id` interno — mapeamento
obrigatório: `raw_captures.event_id` e a rota usam `events.id`, não `cbtm_event_id`):

| CBTM ID | events.id | raw_captures | status predominante |
|---:|---:|---:|---|
| 4849 | 26 | 348 | PARTIAL |
| 4953 | 29 | 1.182 | PARTIAL |
| 5219 | 38 | 43 | PARTIAL |
| 5247 | 39 | 31 | PARTIAL |
| 5368 | 43 | 717 | PARTIAL |
| 5468 | 44 | 55.162 | PARTIAL |
| 5476 | 45 | 6.419 | PARTIAL (6.300) + ERROR (119) |
| 5480 | 49 | 8.901 | PARTIAL |
| 5542 | 50 | 9.886 | PARTIAL |
| 5688 | 52 | 18.869 | PARTIAL |
| 5707 | 54 | 36 | PARTIAL |
| 5827 | 56 | 9.857 | PARTIAL |

Total 111.451 (exclui os 114.987 de `5680`, fora desta execução). 0 de `SUCCESS`, 0 sem `scrapeRunId`.

**Achado crítico confirmado:** com a política padrão atual (`errorDays=0`), `rawCapturesPrunable=0` para
todos — executar a rota como está hoje não teria nenhum efeito. É necessário um prazo de retenção temporário
para tornar `PARTIAL`/`ERROR` elegíveis, sem alterar a variável de ambiente global do worker/cron (que
continuaria protegendo indefinidamente os outros 10 eventos não aprovados).

**Duas implementações de `RawCaptureRetentionService` existem** (`apps/api/.../raw-capture-retention.service.ts`
e `apps/worker/src/pipeline/raw-capture-retention.service.ts`) — não são idênticas (API valida `process.env`
com fallback para não-finito e injeta `PrismaService`; worker usa `config`/`Number()` sem o mesmo fallback e
singleton `prisma`; só API retorna `retentionPolicy`; só worker tem teste unitário direto dos helpers). Com
defaults válidos ambas decidem igual; com env inválida podem divergir. Fonte de verdade desta Spec: a
implementação da API, pois a execução usa a rota admin. Duplicação registrada como dívida técnica — não
corrigida aqui (ver Fora de escopo).

## Causa raiz

- Causa imediata: a política de retenção padrão nunca foi desenhada para permitir uma exceção pontual e
  auditada por evento — só tem a env var global (`RAW_CAPTURE_RETENTION_DAYS_ERROR`), que ou protege tudo
  indefinidamente (default `0`) ou libera tudo igualmente se mudada globalmente.
- Causa sistêmica: retenção de dado bruto (`RawCapture`) foi implementada (achado I3 do CAT PP-026) sem
  mecanismo de exceção por evento já auditado — cada limpeza pontual e segura, como esta, exigiria mudar a
  env var global (afetando todos os eventos) ou aceitar zero efeito.
- Padrão: relacionado ao achado A2 do CAT PP-026 (falta de camada de domínio/config granular entre
  Controller e Service) — mesma classe de lacuna, escopo menor aqui (só a política de retenção, não o
  domínio inteiro).

## Cenários funcionais (DADO/QUANDO/ENTÃO)

**Cenário 1 — override de retenção não afeta o cron nem outros eventos**
DADO o `RawCaptureRetentionService.cleanup()` chamado com `input.errorDaysOverride = 7` para
`eventId = 26` (evento 4849)
QUANDO a execução ocorre
ENTÃO só os runs `PARTIAL`/`ERROR` do evento 26 com `startedAt` há mais de 7 dias tornam-se elegíveis;
nenhum outro evento é afetado, e a variável de ambiente `RAW_CAPTURE_RETENTION_DAYS_ERROR` do processo
permanece com seu valor original (não é sobrescrita globalmente).

**Cenário 2 — sem override, comportamento idêntico ao atual (regressão zero)**
DADO uma chamada a `cleanup({ eventId, dryRun })` sem `errorDaysOverride`
QUANDO executada
ENTÃO o resultado é idêntico ao comportamento pré-Spec — usa `process.env.RAW_CAPTURE_RETENTION_DAYS_ERROR`
normalmente.

**Cenário 3 — dry-run não apaga nada, mesmo com override**
DADO `dryRun: true` e `errorDaysOverride: 7`
QUANDO executado
ENTÃO `rawCapturesDeleted = 0` sempre, `rawCapturesPrunable` reflete o que seria elegível.

**Cenário 4 — validação de input do novo campo**
DADO um valor inválido para `errorDaysOverride` (negativo, não-numérico, ou string)
QUANDO a rota recebe a requisição
ENTÃO retorna erro de validação (400), sem chegar a `cleanup()` — mesmo padrão de validação já aplicado a
`eventId`/`dryRun` no DTO (`class-validator`).

**Cenário 5 — teste real acontece primeiro em `cbtm_homolog`, produção só depois**
DADO a ordem de execução decidida no ciclo tripartite
QUANDO a Spec é implementada e executada
ENTÃO: 1) dump incremental de `raw_captures` dos 12 eventos verdes, VM → `cbtm_homolog`; 2) `dryRun: true`
em `cbtm_homolog` com `errorDaysOverride: 7`, resultado revisado por Leo; 3) `dryRun: false` em
`cbtm_homolog`, `rawCapturesDeleted` confirmado e demais tabelas verificadas intactas; 4) só após Leo
revisar o resultado do teste local, os mesmos passos 2-3 se repetem contra produção.

## Critérios de aceitação

- `CleanupInput`/`RawCaptureCleanupDto` estendidos com `errorDaysOverride?: number` opcional, validado
  (inteiro, `>= 0`).
- `RawCaptureRetentionService.cleanup()`: quando `errorDaysOverride` presente, usado no lugar de
  `process.env.RAW_CAPTURE_RETENTION_DAYS_ERROR` só naquela chamada — env var do processo não é
  sobrescrita (Cenário 1).
- Sem `errorDaysOverride`: comportamento idêntico ao atual (Cenário 2).
- Restrito à rota por evento (`:id/raw-captures/cleanup`) — rota global não recebe/usa esse campo.
- Dump incremental de `raw_captures` dos 12 eventos verdes aplicado em `cbtm_homolog` antes de qualquer
  execução real em produção (Cenário 5).
- Execução real (`dryRun: false`, `errorDaysOverride: 7`) primeiro em `cbtm_homolog`, com resultado
  revisado por Leo antes de repetir em produção.
- `5680` não é tocado por esta Spec, em nenhum ambiente.
- Ao final, arquivos temporários do dump incremental removidos (mesmo padrão de limpeza da PP-039).

## Fora de escopo

- Não tocar nos 10 eventos fora do grupo "verde confirmado" (5 vermelho + `5246`/`6013`, 3 amarelo,
  `6054`) nem em `5680` (investigação de inflação pendente).
- Não alterar `RAW_CAPTURE_RETENTION_DAYS_ERROR` como variável de ambiente global do worker/cron — só o
  override por chamada, escopado ao evento da requisição.
- Não usar a rota global `POST /admin/events/raw-captures/cleanup`.
- Não corrigir a duplicação entre as duas implementações de `RawCaptureRetentionService` (api/worker) —
  registrar como dívida técnica.
- Não automatizar esta limpeza pontual como rotina recorrente — execução manual e auditada por evento.

## Impacto técnico

- Arquivos a criar/modificar:
  - `apps/api/src/admin/dto/raw-capture-cleanup.dto.ts` — novo campo opcional `errorDaysOverride`.
  - `apps/api/src/admin/raw-capture-retention.service.ts` — `cleanup()` usa `input.errorDaysOverride` no
    lugar do env var quando presente (linha ~79).
  - `apps/api/src/admin/admin-events.service.ts` — repassar `errorDaysOverride` do body ao `input` de
    `cleanup()` (linha ~636-641), se necessário ajuste de assinatura.
  - `apps/api/src/admin/admin-events.controller.ts` — repassar campo do `RawCaptureCleanupDto` (linha
    ~130-139), só na rota por evento.
- Arquivos que NÃO devem ser tocados: `apps/worker/src/pipeline/raw-capture-retention.service.ts` (a
  duplicação é dívida técnica registrada, não corrigida aqui), `apps/worker/src/main.ts` (cron inalterado),
  rota global de cleanup (`admin-events.controller.ts` linha ~122-128).
- DDL: nenhuma.
- Contrato de API: `RawCaptureCleanupDto` ganha campo opcional — não quebra chamadas existentes
  (Cenário 2).
- Dependências novas: nenhuma.

## Plano de testes

### Cobertura geral
- camadas obrigatórias: unitário (API) + verificação operacional (dump/restore/execução em
  `cbtm_homolog` e produção, mesmo formato de checagem da PP-039).
- arquivos de teste a criar/estender: teste de `RawCaptureRetentionService.cleanup()` (Codex localiza
  arquivo existente do serviço da API, se houver, ou cria `raw-capture-retention.service.test.ts` seguindo
  padrão dos testes do worker já existentes em `apps/worker/test/raw-capture-retention.test.ts`).

### T-U-01 — Override aplica prazo só na chamada, sem tocar env var do processo
DADO: `process.env.RAW_CAPTURE_RETENTION_DAYS_ERROR = "0"`, uma run `PARTIAL` com `startedAt` há 10 dias
QUANDO: `cleanup({ eventId, errorDaysOverride: 7 })` é chamado
ENTÃO: a run entra em `rawCapturesPrunable`/é elegível (10 > 7), e
`process.env.RAW_CAPTURE_RETENTION_DAYS_ERROR` continua `"0"` após a chamada.

### T-U-02 — Sem override, comportamento idêntico ao atual
DADO: mesmo cenário do T-U-01, mas sem `errorDaysOverride`
QUANDO: `cleanup({ eventId })` é chamado
ENTÃO: a run `PARTIAL` de 10 dias permanece retida (comportamento pré-Spec, `errorDays=0` = mantém
indefinidamente).

### T-U-03 — Override não afeta outro evento na mesma chamada em lote (se aplicável) ou em chamada separada
DADO: dois eventos, A com `errorDaysOverride: 7` e B sem override, ambos com runs `PARTIAL` de 10 dias
QUANDO: `cleanup({ eventId: A, errorDaysOverride: 7 })` e depois `cleanup({ eventId: B })` são chamados em
sequência
ENTÃO: A tem a run elegível, B continua retida — sem vazamento de estado entre chamadas.

### T-U-04 — Dry-run com override não deleta
DADO: `errorDaysOverride: 7`, `dryRun: true`, run `PARTIAL` elegível pelo novo prazo
QUANDO: `cleanup()` é chamado
ENTÃO: `rawCapturesDeleted = 0`, `rawCapturesPrunable > 0`.

### T-U-05 — Validação rejeita override inválido
DADO: `errorDaysOverride: -1` (ou string não numérica) no body da requisição
QUANDO: a rota `POST /admin/events/:id/raw-captures/cleanup` recebe a requisição
ENTÃO: retorna 400, `cleanup()` nunca é chamado.

### T-I-01 — Restore incremental de `raw_captures` em `cbtm_homolog` confere com produção
DADO: dump incremental de `raw_captures` dos 12 eventos verdes, gerado na VM e restaurado em
`cbtm_homolog`
QUANDO: `SELECT COUNT(*) FROM raw_captures WHERE event_id IN (12 ids)` roda nas duas bases
ENTÃO: contagens idênticas.

### T-I-02 — Dry-run em `cbtm_homolog` reporta o mesmo total esperado
DADO: `cbtm_homolog` com `raw_captures` complementado
QUANDO: `cleanup({ eventId, dryRun: true, errorDaysOverride: 7 })` roda para cada um dos 12 eventos
ENTÃO: soma de `rawCapturesPrunable` é coerente com os totais de `PARTIAL`/`ERROR` com `startedAt` há mais
de 7 dias (valor exato registrado no relatório, comparado à tabela desta Spec).

### T-I-03 — Execução real em `cbtm_homolog` deleta e preserva o resto
DADO: `cbtm_homolog` após T-I-02
QUANDO: `cleanup({ eventId, dryRun: false, errorDaysOverride: 7 })` roda para os 12 eventos
ENTÃO: `rawCapturesDeleted` bate com `rawCapturesPrunable` do dry-run; `events`, `athletes`, `matches`,
`categories` permanecem com a mesma contagem de antes (nenhuma tabela fora de `raw_captures`/`scrape_runs`
é tocada).

### Cobertura de falhas silenciosas
- Regra de negócio: T-U-01/T-U-03 cobrem explicitamente que o override não vaza para outro evento nem
  para o processo global — a violação que esta Spec existe para evitar.
- Persistência: T-I-03 lê o estado pós-operação diretamente no banco (contagem de linhas), não confia em
  mensagem de sucesso da chamada HTTP.

### Comando para rodar a suite
`npm run test --workspace apps-api`. T-I-01 a T-I-03 são verificações operacionais (não suite automatizada)
executadas contra `cbtm_homolog` e depois produção, com saída literal registrada no relatório de entrega.
