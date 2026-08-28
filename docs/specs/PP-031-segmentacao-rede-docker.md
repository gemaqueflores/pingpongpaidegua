# PP-031 — Segmentação de redes Docker (isolar Postgres/Redis de serviços não essenciais)

## Status: v2 — topologia de rede única substituída por 3 redes segmentadas (contraponto verificado)

## Prioridade: Média (3 de 3 — CAT PP-026, achado de PP-028 R2). Após PP-029/PP-030 e mapeamento de
## dependências confirmado.

## Skills Codex a ativar
- florestech-implementacao
- security-review-agent: sim.
- e2e-playwright-agent: não.
- report-builder-agent: sim — o relatório de entrega deve incluir o mapa de dependências de rede
  levantado antes da segmentação, não só o resultado final.

## Objetivo

Reduzir a superfície de rede interna do Docker Compose para que nenhum serviço alcance um datastore
(`postgres`/`redis`) sem necessidade real de comunicação, sem quebrar nenhum fluxo hoje existente.

## Errata v1 → v2 (correção de desenho aceita)

**Achado:** a topologia proposta na v1 (uma única rede `data-tier` contendo `postgres`, `redis`, `api`,
`worker`) **não reduz o alcance atual** — é exatamente a mesma composição que já existe hoje na rede
default do Compose, apenas com nome diferente. Não resolve o problema que a Spec se propõe a resolver
(Postgres e Redis continuariam se enxergando mutuamente, e ambos continuariam alcançáveis por qualquer
serviço na mesma rede única).

**Corrigido — 3 redes segmentadas:**
- **`postgres-tier`**: `postgres` + `api` + `worker`.
- **`redis-tier`**: `redis` + `api` + `worker`.
- **`app-tier`**: `api` + `worker` + `frontend` (se `frontend` estiver ativo na topologia de produção —
  a confirmar no mapeamento de dependências, ver seção abaixo).

Com isso:
- `postgres` não resolve `redis` (redes diferentes, sem membro em comum entre elas além de api/worker
  que têm interface em ambas).
- `redis` não resolve `postgres`.
- `frontend` não alcança diretamente nenhum datastore (só está em `app-tier`, que não inclui
  `postgres`/`redis`).
- `api` e `worker` preservam todos os fluxos atuais (membros das 3 redes).
- `worker` continua alcançando `api` via `app-tier` para o prewarm
  (`READ_MODEL_PREWARM_API_BASE_URL: http://api:4000`).

**Sobre `internal: true` (correção aceita — não aplicar indiscriminadamente):** `postgres-tier` e
`redis-tier` **não devem** ser marcadas como `internal: true`, porque `api` e `worker` (membros dessas
redes) precisam de saída externa (chamadas HTTP ao CBTM, ao próprio scraper, etc.) — uma rede `internal`
bloqueia todo tráfego de saída para os membros, não apenas o tráfego entre os datastores. Isolar
`api`/`worker` do egress exigiria uma rede adicional dedicada a isso, fora do escopo desta Spec (a
topologia já usa a rede default/bridge padrão para egress, que continua disponível a `api`/`worker`
independente das redes de dados adicionais).

**Testes corrigidos:** verificar resolução/conexão real entre pares de serviços (ex.: tentativa de
conexão TCP na porta correta), não `ping` — a maioria das imagens usadas (`postgres:16-alpine`,
`redis:7-alpine`, `node:20-alpine`) não inclui `ping`/`iputils` por padrão.

## Pré-requisito — mapeamento de dependências reais (obrigatório antes de qualquer mudança de rede)

Codex confirma via leitura de código + configuração real:
- `api` → `postgres` (sim, `API_DATABASE_URL_WRITE`/`READ`, pós-PP-029).
- `api` → `redis` (sim, `queue.service.ts`, `simple-rate-limit.middleware.ts`).
- `worker` → `postgres` (sim, `WORKER_DATABASE_URL_WRITE`/`READ`, pós-PP-029).
- `worker` → `redis` (sim, fila BullMQ compartilhada).
- `worker` → `api` (sim, `READ_MODEL_PREWARM_API_BASE_URL: http://api:4000`, `docker-compose.yml:165`).
- `frontend` → `api` (sim, `API_INTERNAL_URL: http://api:4000`) — **mas roda em profile `local-ui`**;
  Codex confirma se `frontend` está de fato ativo na topologia de produção real (VM Oracle) ou se o
  Next.js roda via Vercel fora do compose de produção, tornando essa dependência irrelevante para a
  topologia de produção (nesse caso, `app-tier` pode nem ser necessária em produção, só em dev local).
- `frontend` → `postgres`/`redis` — sem dependência direta confirmada por leitura; permanece fora de
  `postgres-tier`/`redis-tier` em qualquer cenário.

## Cenários funcionais (DADO/QUANDO/ENTÃO)

**Cenário 1 — Postgres e Redis mutuamente isolados**
DADO as 3 redes segmentadas aplicadas
QUANDO o container `postgres` tenta resolver/conectar ao container `redis` por nome (ou vice-versa)
ENTÃO a conexão falha — nenhuma rede em comum entre `postgres` e `redis` diretamente.

**Cenário 2 — frontend não alcança datastores**
DADO `frontend` presente apenas em `app-tier`
QUANDO `frontend` tenta resolver `postgres`/`redis` por nome
ENTÃO falha de resolução.

**Cenário 3 — fluxos existentes não regridem**
DADO a nova topologia aplicada
QUANDO os fluxos existentes rodam (API↔Postgres, Worker↔Postgres, API↔Redis, Worker↔Redis,
Worker→API para prewarm)
ENTÃO todos funcionam exatamente como antes — validado por tentativa de conexão real (TCP), não `ping`.

## Critérios de aceitação

- Mapa de dependências de rede documentado no relatório de entrega, confirmado por leitura de código.
- 3 redes (`postgres-tier`, `redis-tier`, `app-tier`) aplicadas conforme desenho acima — nenhuma delas
  `internal: true`.
- `postgres` não alcança `redis` e vice-versa (Cenário 1, validado).
- `frontend` (se presente na topologia de produção) não alcança `postgres`/`redis` (Cenário 2, validado).
- Nenhuma regressão de conectividade entre os serviços que hoje se comunicam (Cenário 3, validado por
  smoke test real).
- Implementada depois de PP-029/PP-030 concluídas.

## Fora de escopo

- Isolamento de egress de `api`/`worker` — rede adicional dedicada, fora desta Spec.
- Não resolve o caso de um serviço legítimo da rede de dados ser comprometido — isso é mitigado por
  PP-027/PP-028/PP-030 (credenciais/autenticação), não por segmentação de rede.

## Impacto técnico

- Arquivos a modificar: `docker-compose.yml` — declaração de `networks:` (`postgres-tier`, `redis-tier`,
  `app-tier`, sem `internal: true`) e atribuição por serviço.
- DDL: nenhuma.
- Rollback: reverter `docker-compose.yml` para a versão sem redes customizadas (Compose usa rede default
  automaticamente) — não destrutivo.
- **Janela de deploy:** esta migração precisa recriar os 4 serviços (`postgres`, `redis`, `api`,
  `worker`), não apenas `api`/`worker` como o workflow padrão `deploy-backend.yml` faz — mesma ressalva
  já registrada em PP-029.

## Plano de testes

### T-C-01 — Mapeamento de dependências confirmado por leitura (pré-requisito, não teste automatizado)
Codex entrega o mapa de dependências real (incluindo a confirmação sobre `frontend` em produção) antes de
aplicar a topologia — critério de aceitação, não T-* de código.

### T-I-01 — Postgres e Redis não se alcançam
DADO a topologia aplicada em ambiente de teste/staging
QUANDO uma tentativa de conexão TCP na porta 5432 é feita a partir do container `redis` (ou porta 6379 a
partir de `postgres`)
ENTÃO a conexão falha (timeout/recusa) — evidência de comando real (ex.: `nc -zv` se disponível na
imagem, ou tentativa via cliente apropriado), não `ping`.

### T-I-02 — Frontend não alcança datastores (se aplicável à topologia de produção)
DADO `frontend` presente apenas em `app-tier`
QUANDO uma tentativa de conexão TCP às portas 5432/6379 é feita a partir do container `frontend`
ENTÃO falha.

### T-I-03 — Fluxos existentes preservados (smoke test real)
DADO a topologia aplicada
QUANDO o smoke test já usado em `deploy-backend.yml` roda (`curl http://localhost:4000/`,
`curl http://localhost:4000/events/:id`)
ENTÃO responde `200` normalmente.

### Comando para rodar a suite
`docker compose config` + smoke test manual equivalente ao já usado em `deploy-backend.yml`.
