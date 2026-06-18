# AUDITORIA — Evento 3TMB26 em produção

**Data de emissão:** 2026-06-16  
**Solicitante:** Leo  
**Executor:** Codex via MCP ssh-oracle + acesso direto ao banco PostgreSQL em produção  
**Objetivo:** detectar bugs, lacunas e melhorias necessárias antes de um evento Copa de maior porte (atletas e clubes de outros estados)

---

## Contexto

O evento 3TMB26 é um evento agregado:
- `id=51` — evento canonical (`3TMB26 - Mestre Bianor Coelho`)
- `id=52` — evento filho (`3TMB26 - DUPLAS`)
- `id=53` — evento filho (`3TMB26 - DUPLAS MISTAS`)

A agregação é via `event_merges`. `resolveEventScope(51)` deve retornar `allEventIds=[51,52,53]`.

Servidor de produção: `ubuntu@129.213.86.180` (chave em `Documents/estudos/ssh-keys/pingpongpaidegua/ssh-key-2026-04-02.key`).

Stack em produção: NestJS API + PostgreSQL + Redis + BullMQ worker + Next.js frontend, via Docker Compose.

---

## Domínios a auditar

### 1. Integridade do evento agregado

**Queries a executar:**

```sql
-- 1.1 Estrutura do evento canonical e filhos
SELECT id, nome, situacao_computada, total_partidas_publicadas, groups_defined,
       data_inicio, data_fim, updated_at
FROM events
WHERE id IN (51, 52, 53)
ORDER BY id;

-- 1.2 Relações de merge
SELECT * FROM event_merges WHERE parent_event_id = 51 OR child_event_id IN (51,52,53);

-- 1.3 Categorias por evento (contagem e IDs ignorados)
SELECT e.id, e.nome,
       COUNT(DISTINCT c.id) as total_categorias,
       COUNT(DISTINCT CASE WHEN c.cbtm_category_id NOT IN ('88888888','99999999') THEN c.id END) as categorias_ativas
FROM events e
LEFT JOIN categories c ON c.event_id = e.id
WHERE e.id IN (51,52,53)
GROUP BY e.id, e.nome
ORDER BY e.id;
```

---

### 2. Atletas e duplas

**Queries a executar:**

```sql
-- 2.1 Contagem de atletas por evento (individuais vs duplas)
SELECT e.id, e.nome,
       COUNT(DISTINCT r.athlete_id) as total_atletas,
       COUNT(DISTINCT CASE WHEN a.name_display LIKE '%#%' THEN r.athlete_id END) as pares_duplas,
       COUNT(DISTINCT CASE WHEN a.name_display NOT LIKE '%#%' THEN r.athlete_id END) as individuais
FROM events e
JOIN registrations r ON r.event_id = e.id
JOIN athletes a ON a.id = r.athlete_id
WHERE e.id IN (51,52,53)
GROUP BY e.id, e.nome
ORDER BY e.id;

-- 2.2 Duplas com name_display malformado (sem # ou com mais de um #)
SELECT a.id, a.name_display, a.name_normalized, COUNT(r.id) as registrations
FROM athletes a
JOIN registrations r ON r.athlete_id = a.id
WHERE r.event_id IN (52, 53)
  AND (a.name_display NOT LIKE '%#%' OR a.name_display LIKE '%#%#%')
GROUP BY a.id, a.name_display, a.name_normalized
ORDER BY a.name_display
LIMIT 50;

-- 2.3 Pares sem clube associado
SELECT a.id, a.name_display, r.club_id
FROM athletes a
JOIN registrations r ON r.athlete_id = a.id
WHERE r.event_id IN (52, 53)
  AND a.name_display LIKE '%#%'
  AND r.club_id IS NULL
LIMIT 30;
```

---

### 3. Partidas e confrontos

**Queries a executar:**

```sql
-- 3.1 Resumo de partidas por evento
SELECT e.id, e.nome,
       COUNT(m.id) as total_matches,
       COUNT(CASE WHEN m.match_datetime IS NOT NULL THEN 1 END) as com_horario,
       COUNT(CASE WHEN m.score_raw IS NOT NULL AND m.score_raw != '' THEN 1 END) as com_placar,
       COUNT(CASE WHEN m.athlete_a_name IS NULL OR m.athlete_b_name IS NULL THEN 1 END) as sem_atleta,
       MIN(m.match_datetime) as primeiro_jogo,
       MAX(m.match_datetime) as ultimo_jogo
FROM events e
LEFT JOIN matches m ON m.event_id = e.id
WHERE e.id IN (51,52,53)
GROUP BY e.id, e.nome
ORDER BY e.id;

-- 3.2 Partidas de duplas: verificar se athleteAName e athleteBName contêm #
SELECT
  COUNT(*) as total_duplas_matches,
  COUNT(CASE WHEN m.athlete_a_name LIKE '%#%' THEN 1 END) as a_com_hash,
  COUNT(CASE WHEN m.athlete_b_name LIKE '%#%' THEN 1 END) as b_com_hash,
  COUNT(CASE WHEN m.athlete_a_name NOT LIKE '%#%' THEN 1 END) as a_sem_hash,
  COUNT(CASE WHEN m.athlete_b_name NOT LIKE '%#%' THEN 1 END) as b_sem_hash
FROM matches m
JOIN categories c ON c.id = m.category_id
WHERE m.event_id IN (52, 53)
  AND c.cbtm_category_id NOT IN ('88888888','99999999');

-- 3.3 Amostra de partidas de duplas com atletas individuais (bug parser pré-PP-008)
SELECT m.id, m.event_id, c.name as categoria, m.athlete_a_name, m.athlete_b_name,
       m.score_raw, m.match_datetime
FROM matches m
JOIN categories c ON c.id = m.category_id
WHERE m.event_id IN (52, 53)
  AND m.athlete_a_name NOT LIKE '%#%'
  AND c.cbtm_category_id NOT IN ('88888888','99999999')
LIMIT 20;

-- 3.4 Partidas com atletas trocados (mesmo par dos dois lados — bug parser)
SELECT m.id, m.athlete_a_name, m.athlete_b_name, m.event_id
FROM matches m
WHERE m.event_id IN (52, 53)
  AND m.athlete_a_name = m.athlete_b_name
LIMIT 10;

-- 3.5 Partidas de grupos: verificar contagem (bug .slice(0,4) e .slice(0,8) pré-B3)
SELECT c.name as categoria, m.phase,
       COUNT(m.id) as partidas,
       COUNT(DISTINCT m.athlete_a_name) + COUNT(DISTINCT m.athlete_b_name) as nomes_distintos
FROM matches m
JOIN categories c ON c.id = m.category_id
WHERE m.event_id IN (52, 53)
  AND m.phase ILIKE '%grupo%'
  AND c.cbtm_category_id NOT IN ('88888888','99999999')
GROUP BY c.name, m.phase
ORDER BY c.name;
```

---

### 4. Read models e cache

**Queries a executar:**

```sql
-- 4.1 Estado dos read_model_caches para o canonical 51
SELECT kind, event_id, updated_at, expired_at,
       length(payload::text) as payload_bytes
FROM read_model_caches
WHERE event_id = 51
ORDER BY kind;

-- 4.2 Verificar se filhos 52/53 têm caches separados (não deveriam por design)
SELECT kind, event_id, updated_at
FROM read_model_caches
WHERE event_id IN (52, 53)
ORDER BY event_id, kind;
```

---

### 5. Worker e pipeline

**Comandos a executar no servidor:**

```bash
# 5.1 Status dos containers
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# 5.2 Logs recentes do worker (últimas 100 linhas)
docker logs appcbtmeventos-worker-1 --tail 100 2>&1

# 5.3 Filas BullMQ via Redis (jobs pendentes, falhos, concluídos)
docker exec appcbtmeventos-redis-1 redis-cli info keyspace
docker exec appcbtmeventos-redis-1 redis-cli keys "bull:*" | head -30

# 5.4 Jobs com falha na fila
docker exec appcbtmeventos-redis-1 redis-cli llen bull:pipeline:failed 2>/dev/null || true
docker exec appcbtmeventos-redis-1 redis-cli lrange bull:pipeline:failed 0 5 2>/dev/null || true

# 5.5 Último scrape do evento 51 (timestamp)
docker exec appcbtmeventos-postgres-1 psql -U postgres -d pingpong -c \
  "SELECT event_id, scrape_type, completed_at, status FROM scrape_logs WHERE event_id IN (51,52,53) ORDER BY completed_at DESC LIMIT 10;" 2>/dev/null || \
  echo "tabela scrape_logs nao existe — verificar alternativa"
```

---

### 6. API em produção — smoke check

**Comandos a executar:**

```bash
BASE="https://api.pingpongpaidegua.com.br"  # ajustar se URL diferente

# 6.1 Evento canonical
curl -s "$BASE/events/51" | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps({k:d.get(k) for k in ['id','nome','situacaoComputada','totalPartidasPublicadas','groupsDefined']}, indent=2))"

# 6.2 Schedule do evento (confrontos)
curl -s "$BASE/events/51/schedule" | python3 -c "import sys,json; d=json.load(sys.stdin); cats=d.get('categories',[]); print(f'categorias: {len(cats)}, total_matches: {sum(len(c[\"matches\"]) for c in cats)}')"

# 6.3 Atletas do evento (verificar duplas visíveis)
curl -s "$BASE/events/51/athletes?q=" | python3 -c "import sys,json; d=json.load(sys.stdin); items=d.get('items',[]); duplas=[x for x in items if '#' in (x.get('nameDisplay') or '')]; print(f'total: {len(items)}, duplas: {len(duplas)}')"

# 6.4 OpenGraph da página (PP-007 — verificar título)
curl -s "https://pingpongpaidegua.vercel.app/events/51" | grep -o '<title>[^<]*</title>' | head -3

# 6.5 URL base da API (detectar)
curl -sI "$BASE/events/51" | head -5 || echo "URL base pode ser diferente — ajustar"
```

---

## Formato de resposta esperado do Codex

Para cada domínio (1 a 6), reportar:

```
### Domínio N — <nome>
STATUS: ok | atenção | bug | lacuna

Resultados das queries/comandos (saída bruta ou resumo se muito longa):
<saída>

Observações:
- <o que está correto>
- <o que está incorreto ou suspeito>
- <edge cases encontrados>
```

Ao final, consolidar:

```
## Consolidado

### Bugs confirmados
- [descrição] — domínio N, evidência: <dado da query>

### Lacunas / melhorias
- [descrição] — domínio N

### Pontos OK
- [descrição]

### Recomendações para evento Copa (atletas multi-estados)
- [o que pode quebrar ou degradar com escala maior]
```

---

## Notas de segurança para o Codex

- Executar apenas SELECTs no banco — nenhum UPDATE, DELETE ou INSERT
- Não expor credenciais, senhas ou tokens na saída
- Se alguma query demorar mais de 30s, interromper e reportar timeout
- URL base da API em produção: verificar `docker inspect appcbtmeventos-api-1` para confirmar porta exposta, ou ler nginx config
