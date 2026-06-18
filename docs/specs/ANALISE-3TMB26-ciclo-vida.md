# ANÁLISE — Ciclo de vida completo do evento 3TMB26

**Data de emissão:** 2026-06-16  
**Solicitante:** Leo  
**Executor:** Codex via MCP ssh-oracle  
**Analisador:** Claude (após receber os dados)  
**Objetivo:** entender o ciclo de vida completo do evento agregado 3TMB26 (canonical 51, filhos 52 e 53) do primeiro ao último scrape — identificar padrões de falha, anomalias de pipeline, e oportunidades de melhoria — antes de qualquer intervenção de limpeza ou automação.

---

## Contexto

O evento 3TMB26 é o maior evento já processado pelo pipeline. Seus `scrape_runs` são a fonte primária de diagnóstico: cada run registra `status`, `warnings`, `extraction_stats` (com `conformanceAudit`, `postScrape`, `dataTotals`, `capture`, `strictQualityGate`), `inserted_counts`, `updated_counts`, `error_message`, `started_at`, `finished_at`.

Os 11 jobs falhos no Redis (`bull:scrape-event:failed`) são uma **fonte separada**: representam falhas que ocorreram no nível do worker BullMQ — seja antes de criar o `scrapeRun`, seja por timeout/crash do próprio worker. Seu `failedReason` e `stacktrace` são os únicos registros dessas falhas.

A análise combina as duas fontes para reconstruir o ciclo de vida completo.

---

## Instruções para o Codex

### Pré-condições

Servidor: `ubuntu@129.213.86.180`  
Chave SSH: `~/Documents/estudos/ssh-keys/pingpongpaidegua/ssh-key-2026-04-02.key`  
Banco: `-U postgres -d cbtm`  
Containers: `appcbtmeventos-postgres-1`, `appcbtmeventos-redis-1`

**Apenas leitura no banco e no Redis. Nenhum UPDATE, DELETE, INSERT ou comando destrutivo.**

---

### Bloco 1 — Visão geral dos scrape_runs (todos os eventos 51, 52, 53)

```sql
SELECT
  sr.id,
  sr.event_id,
  sr.status,
  sr.started_at,
  sr.finished_at,
  EXTRACT(EPOCH FROM (sr.finished_at - sr.started_at))::int AS duration_seconds,
  sr.error_message,
  jsonb_array_length(sr.warnings::jsonb) AS warning_count,
  (sr.extraction_stats::jsonb -> 'dataTotals' ->> 'totalMatches')::int AS total_matches,
  (sr.extraction_stats::jsonb -> 'dataTotals' ->> 'totalAthletes')::int AS total_athletes,
  (sr.extraction_stats::jsonb -> 'dataTotals' ->> 'totalMatchParticipants')::int AS total_participants,
  (sr.extraction_stats::jsonb -> 'conformanceAudit' ->> 'matchMismatches')::int AS match_mismatches,
  (sr.extraction_stats::jsonb -> 'conformanceAudit' ->> 'registrationMismatches')::int AS reg_mismatches,
  (sr.extraction_stats::jsonb -> 'postScrape' -> 'conflictAutofix' ->> 'resolved')::int AS conflicts_resolved,
  (sr.extraction_stats::jsonb -> 'postScrape' -> 'conflictAutofix' ->> 'backlogPending')::int AS conflicts_pending,
  (sr.extraction_stats::jsonb -> 'postScrape' -> 'conflictAutofix' ->> 'noCandidatesInPool')::int AS conflicts_no_pool,
  (sr.extraction_stats::jsonb -> 'capture' ->> 'source') AS capture_source,
  (sr.extraction_stats::jsonb -> 'strictQualityGate' ->> 'violated')::boolean AS strict_gate_violated
FROM scrape_runs sr
WHERE sr.event_id IN (51, 52, 53)
ORDER BY sr.event_id, sr.started_at;
```

---

### Bloco 2 — Warnings de cada run (texto completo)

```sql
SELECT
  sr.id AS run_id,
  sr.event_id,
  sr.status,
  sr.started_at::date AS run_date,
  warning
FROM scrape_runs sr
CROSS JOIN jsonb_array_elements_text(sr.warnings::jsonb) AS warning
WHERE sr.event_id IN (51, 52, 53)
ORDER BY sr.event_id, sr.started_at, warning;
```

---

### Bloco 3 — Detalhe dos runs com status ERROR

```sql
SELECT
  sr.id,
  sr.event_id,
  sr.started_at,
  sr.finished_at,
  sr.error_message,
  sr.warnings::text AS warnings_raw,
  sr.extraction_stats::text AS extraction_stats_raw
FROM scrape_runs sr
WHERE sr.event_id IN (51, 52, 53)
  AND sr.status = 'ERROR'
ORDER BY sr.started_at;
```

---

### Bloco 4 — Evolução dos totais ao longo do tempo (série temporal)

```sql
SELECT
  sr.id AS run_id,
  sr.event_id,
  sr.status,
  sr.started_at,
  (sr.extraction_stats::jsonb -> 'dataTotals' ->> 'totalMatches')::int AS matches,
  (sr.extraction_stats::jsonb -> 'dataTotals' ->> 'totalAthletes')::int AS athletes,
  (sr.extraction_stats::jsonb -> 'dataTotals' ->> 'totalRegistrations')::int AS registrations,
  (sr.extraction_stats::jsonb -> 'dataTotals' ->> 'totalMatchParticipants')::int AS participants,
  (sr.extraction_stats::jsonb -> 'dataTotals' ->> 'totalCategories')::int AS categories,
  (sr.inserted_counts::jsonb ->> 'matches')::int AS inserted_matches,
  (sr.updated_counts::jsonb ->> 'matches')::int AS updated_matches,
  (sr.inserted_counts::jsonb ->> 'athletes')::int AS inserted_athletes,
  (sr.inserted_counts::jsonb ->> 'match_participants')::int AS inserted_participants
FROM scrape_runs sr
WHERE sr.event_id IN (51, 52, 53)
  AND sr.status IN ('SUCCESS', 'PARTIAL')
ORDER BY sr.event_id, sr.started_at;
```

---

### Bloco 5 — Conformance audit detalhado por run

```sql
SELECT
  sr.id AS run_id,
  sr.event_id,
  sr.started_at,
  sr.status,
  (sr.extraction_stats::jsonb -> 'conformanceAudit' ->> 'categoryCountExpected')::int AS cat_expected,
  (sr.extraction_stats::jsonb -> 'conformanceAudit' ->> 'categoryCountObserved')::int AS cat_observed,
  (sr.extraction_stats::jsonb -> 'conformanceAudit' ->> 'matchMismatches')::int AS match_mismatches,
  (sr.extraction_stats::jsonb -> 'conformanceAudit' ->> 'registrationMismatches')::int AS reg_mismatches,
  (sr.extraction_stats::jsonb -> 'conformanceAudit' ->> 'playedMatchMismatches')::int AS played_mismatches,
  (sr.extraction_stats::jsonb -> 'conformanceAudit' ->> 'eliminatoriaMatchesObserved')::int AS eliminatoria_observed,
  (sr.extraction_stats::jsonb -> 'postScrape' -> 'conflictAutofix' ->> 'resolved')::int AS conflicts_resolved,
  (sr.extraction_stats::jsonb -> 'postScrape' -> 'conflictAutofix' ->> 'backlogPending')::int AS conflicts_pending,
  (sr.extraction_stats::jsonb -> 'postScrape' -> 'conflictAutofix' ->> 'noCandidatesInPool')::int AS no_pool,
  (sr.extraction_stats::jsonb -> 'strictQualityGate' ->> 'violated') AS strict_gate_violated,
  (sr.extraction_stats::jsonb -> 'strictQualityGate' -> 'reasons') AS strict_gate_reasons
FROM scrape_runs sr
WHERE sr.event_id IN (51, 52, 53)
ORDER BY sr.event_id, sr.started_at;
```

---

### Bloco 6 — Jobs falhos no Redis (failedReason + stacktrace)

```bash
# 6.1 Quantidade de jobs falhos
docker exec appcbtmeventos-redis-1 redis-cli zcard bull:scrape-event:failed

# 6.2 IDs dos jobs falhos
docker exec appcbtmeventos-redis-1 redis-cli zrange bull:scrape-event:failed 0 -1

# 6.3 Para cada job ID obtido em 6.2, extrair: eventId, reason, failedReason, stacktrace
# (substituir <JOB_ID> por cada ID retornado)
docker exec appcbtmeventos-redis-1 redis-cli hgetall "bull:scrape-event:<JOB_ID>"
```

Para cada job falho, reportar os campos:
- `data` (JSON com `eventId` e `reason`)
- `failedReason`
- `stacktrace` (primeiras 5 linhas)
- `timestamp` (epoch ms → converter para data legível)
- `attemptsMade`

---

### Bloco 7 — Estado atual pós-ciclo (snapshot final)

```sql
-- 7.1 Estado final do evento e filhos
SELECT id, nome, situacao_computada, total_partidas_publicadas,
       groups_defined, concluido, last_scrape_at, updated_at
FROM events
WHERE id IN (51, 52, 53)
ORDER BY id;

-- 7.2 Conflitos de atletas ainda pendentes
SELECT
  amc.event_id,
  COUNT(*) AS total_conflicts,
  COUNT(CASE WHEN amc.resolved_athlete_id IS NULL THEN 1 END) AS unresolved,
  COUNT(CASE WHEN amc.resolved_athlete_id IS NOT NULL THEN 1 END) AS resolved
FROM athlete_match_conflicts amc
WHERE amc.event_id IN (51, 52, 53)
GROUP BY amc.event_id
ORDER BY amc.event_id;

-- 7.3 Partidas sem match_participants (não aparecem no /schedule)
SELECT
  m.event_id,
  COUNT(*) AS matches_total,
  COUNT(CASE WHEN mp_count.cnt = 2 THEN 1 END) AS fully_resolved,
  COUNT(CASE WHEN mp_count.cnt < 2 OR mp_count.cnt IS NULL THEN 1 END) AS not_fully_resolved
FROM matches m
LEFT JOIN (
  SELECT match_id, COUNT(*) AS cnt
  FROM match_participants
  GROUP BY match_id
) mp_count ON mp_count.match_id = m.id
JOIN categories c ON c.id = m.category_id
WHERE m.event_id IN (51, 52, 53)
  AND c.cbtm_category_id NOT IN ('88888888','99999999')
GROUP BY m.event_id
ORDER BY m.event_id;

-- 7.4 Pares de duplas com athleteId null em scorePlayers
SELECT
  m.event_id,
  c.name AS categoria,
  sp->>'name' AS nome_par,
  m.id AS match_id
FROM matches m
JOIN categories c ON c.id = m.category_id
CROSS JOIN jsonb_array_elements(m.score_players::jsonb) AS sp
WHERE m.event_id IN (52, 53)
  AND (sp->>'athleteId') IS NULL
  AND (sp->>'name') NOT LIKE '%V%'
  AND (sp->>'name') NOT SIMILAR TO '%[0-9]-[0-9]%'
  AND c.cbtm_category_id NOT IN ('88888888','99999999')
ORDER BY m.event_id, c.name, sp->>'name';
```

---

## Formato de resposta esperado do Codex

Para cada bloco (1 a 7), reportar a saída completa ou resumida se muito longa (indicando "N linhas omitidas por brevidade, padrão: X").

Ao final, consolidar:

```
## Resumo do Codex

### Scrape runs por evento
- Evento 51: N runs — SUCCESS: X | PARTIAL: Y | ERROR: Z
- Evento 52: ...
- Evento 53: ...

### Jobs falhos Redis
- Total: 11
- Por tipo de erro: [lista]
- eventId envolvido: [lista]
- Timestamps: [mais antigo → mais recente]

### Anomalias identificadas pelo Codex (sem interpretação — apenas dados)
- [dado literal]
```

A interpretação causal, classificação de padrões e recomendações de melhoria são feitas pelo Claude após receber os dados.

---

## Notas de segurança

- Apenas SELECT no banco e HGETALL/ZRANGE no Redis (leitura)
- Não expor senhas, tokens ou chaves na saída
- Se qualquer query demorar mais de 30s, interromper e reportar timeout com o bloco que travou
