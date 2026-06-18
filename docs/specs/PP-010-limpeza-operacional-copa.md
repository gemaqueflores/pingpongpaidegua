# PP-010 — Limpeza Operacional Pré-Copa

**Aprovação Leo:** _pendente_

---

## Objetivo

Limpar 11 jobs históricos falhos na fila BullMQ e invalidar caches stale do evento filho 53 antes do evento Copa, evitando ruído em dashboards operacionais e servindo dados frescos no próximo scrape.

---

## Contexto

Auditoria do evento 3TMB26 (2026-06-16) identificou:

1. **11 jobs falhos** em `bull:scrape-event:failed` — todos com origem em falhas externas do CBTM ocorridas antes de 2026-03-31 (2 `GetItemsRangeForLoad`, 9 `browser fallback`). Não representam bug no código atual, mas poluem o dashboard e mascaram falhas futuras.

2. **Caches stale do filho 53** (`updated_at: 2026-04-28`) — evento filho 53 (DUPLAS MISTAS) tem caches de read model desatualizados há ~7 semanas. Por design, filhos resolvem para o cache do canonical (evento 51), mas a existência de entradas stale no filho 53 pode gerar inconsistência em `resolveEventReadModelCache`. Limpeza libera memória e força rebuildo no próximo prewarm.

---

## Causa raiz

- Jobs falhos: falhas externas históricas do CBTM — não é bug do código
- Caches stale filho 53: prewarm não varre filhos por design (DEC-CBTM-001 vicinity); os caches existentes nunca foram invalidados explicitamente

---

## Cenários funcionais

**DADO** a fila `bull:scrape-event:failed` com 11 jobs falhos  
**QUANDO** Codex executa limpeza via Redis  
**ENTÃO** `zcard bull:scrape-event:failed` retorna 0

**DADO** caches stale no evento filho 53  
**QUANDO** Codex executa DELETE das entradas stale  
**ENTÃO** `SELECT COUNT(*) FROM read_model_caches WHERE event_id = 53` retorna 0 (ou apenas entradas com `updated_at` recente se o prewarm já tiver rodado entre a limpeza e a verificação)

---

## Critérios de aceitação

1. Fila `bull:scrape-event:failed` zerada após limpeza
2. Caches do evento filho 53 removidos
3. Canonical 51 e filho 52 intocados
4. Nenhum dado de produção (matches, atletas, registrations) alterado

---

## Fora de escopo

- Alteração de código
- Remoção de jobs em outras filas (pending, active, waiting)
- Scrape do evento — não acionar pipeline, apenas limpar dados operacionais

---

## Impacto técnico

Esta spec não altera código — é runbook de operação no servidor de produção via ssh-oracle.

**Arquivos que NÃO devem ser tocados:**
- Qualquer arquivo do repositório Git
- Tabelas `events`, `matches`, `athletes`, `registrations`, `categories`, `athlete_categories`, `match_participants`

**Operações autorizadas no servidor:**
- Redis: `ZREMRANGEBYSCORE bull:scrape-event:failed -inf +inf` (esvaziar zset de jobs falhos)
- PostgreSQL: `DELETE FROM read_model_caches WHERE event_id = 53` (apenas filhos stale)

---

## Plano de testes

### Cobertura geral

Não aplicável (operação de limpeza, sem código novo). Verificações pós-execução substituem testes automatizados.

### T-OP-01 — verificar estado antes da limpeza

DADO: servidor de produção `ubuntu@129.213.86.180`  
QUANDO: Codex conecta via ssh-oracle  
ENTÃO: confirmar:
- `docker exec appcbtmeventos-redis-1 redis-cli zcard bull:scrape-event:failed` → deve retornar 11
- `docker exec appcbtmeventos-postgres-1 psql -U postgres -d cbtm -c "SELECT event_id, COUNT(*) FROM read_model_caches WHERE event_id IN (52,53) GROUP BY event_id"` → deve mostrar contagem para 53

### T-OP-02 — limpar jobs falhos Redis

QUANDO: Codex executa:
```bash
docker exec appcbtmeventos-redis-1 redis-cli zremrangebyscore bull:scrape-event:failed -inf +inf
```
ENTÃO: retorno é o número de jobs removidos (deve ser 11)  
E: `redis-cli zcard bull:scrape-event:failed` → 0

### T-OP-03 — limpar caches stale filho 53

QUANDO: Codex executa:
```sql
DELETE FROM read_model_caches WHERE event_id = 53;
```
via:
```bash
docker exec appcbtmeventos-postgres-1 psql -U postgres -d cbtm -c "DELETE FROM read_model_caches WHERE event_id = 53;"
```
ENTÃO: retorno é `DELETE N` (N > 0)

### T-OP-04 — verificar integridade pós-limpeza

QUANDO: verificações pós-limpeza  
ENTÃO:
- `zcard bull:scrape-event:failed` = 0
- `SELECT COUNT(*) FROM read_model_caches WHERE event_id = 53` = 0
- `SELECT COUNT(*) FROM read_model_caches WHERE event_id = 51` = mesmo valor de antes (canonical intocado)
- `SELECT COUNT(*) FROM read_model_caches WHERE event_id = 52` = mesmo valor de antes (filho 52 intocado)
- `SELECT COUNT(*) FROM matches WHERE event_id IN (51,52,53)` = mesmo valor de antes (sem remoção de partidas)

### Comando para rodar a suite

Operações via ssh-oracle (não há suite automatizada para esta spec).

---

## Orientação para o Codex

```
## Orientação para o Codex — PP-010

### Spec aprovada
caminho: docs/specs/PP-010-limpeza-operacional-copa.md
aprovação Leo: _aguardando_

### Objetivo
Limpeza operacional pré-Copa: zerar fila de jobs falhos no Redis e remover caches stale do evento filho 53.
Nenhum arquivo do repositório deve ser alterado. Toda operação é no servidor de produção via ssh-oracle.

### Contexto
Servidor: ubuntu@129.213.86.180
Chave SSH: ~/Documents/estudos/ssh-keys/pingpongpaidegua/ssh-key-2026-04-02.key
Containers: appcbtmeventos-redis-1, appcbtmeventos-postgres-1

### Sequência obrigatória (executar em ordem, verificar após cada passo)

**Passo 1 — estado antes**
```bash
docker exec appcbtmeventos-redis-1 redis-cli zcard bull:scrape-event:failed
docker exec appcbtmeventos-postgres-1 psql -U postgres -d cbtm -c \
  "SELECT event_id, COUNT(*) as n FROM read_model_caches WHERE event_id IN (51,52,53) GROUP BY event_id ORDER BY event_id"
```
Reportar: contagem da fila e contagem de caches por event_id.

**Passo 2 — limpar jobs falhos**
```bash
docker exec appcbtmeventos-redis-1 redis-cli zremrangebyscore bull:scrape-event:failed -inf +inf
```
Reportar: retorno do comando (número de jobs removidos).

**Passo 3 — limpar caches stale do filho 53**
```bash
docker exec appcbtmeventos-postgres-1 psql -U postgres -d cbtm -c \
  "DELETE FROM read_model_caches WHERE event_id = 53;"
```
Reportar: retorno do comando (DELETE N).

**Passo 4 — verificar integridade pós-limpeza**
```bash
docker exec appcbtmeventos-redis-1 redis-cli zcard bull:scrape-event:failed
docker exec appcbtmeventos-postgres-1 psql -U postgres -d cbtm -c \
  "SELECT event_id, COUNT(*) as n FROM read_model_caches WHERE event_id IN (51,52,53) GROUP BY event_id ORDER BY event_id;
   SELECT COUNT(*) as matches_total FROM matches WHERE event_id IN (51,52,53);
   SELECT COUNT(*) as athletes_total FROM athletes a JOIN registrations r ON r.athlete_id = a.id WHERE r.event_id IN (51,52,53);"
```
ENTÃO: fila = 0; event_id=53 ausente; event_id=51 com mesma contagem de antes; matches_total inalterado.

### Restrições
- Apenas DELETE em read_model_caches WHERE event_id = 53
- Apenas ZREMRANGEBYSCORE na fila bull:scrape-event:failed
- Proibido: UPDATE, DELETE ou INSERT em qualquer outra tabela
- Proibido: acionar scrape, reiniciar containers, alterar código
- Proibido: modificar qualquer arquivo do repositório Git

### Reportar ao concluir
- Saídas literais de cada passo (Passo 1 a 4)
- Confirmação de integridade (matches_total inalterado, event_id=51 caches intactos)
- Se qualquer passo retornar erro: parar e reportar sem prosseguir
```
