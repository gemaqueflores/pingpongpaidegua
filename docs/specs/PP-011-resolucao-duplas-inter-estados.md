# PP-011 — Resolução de Atletas de Duplas com athleteId null

**Aprovação Leo:** _pendente_

---

## Objetivo

Diagnosticar e corrigir a falha de resolução de `athleteId` em `scorePlayers` para pares de duplas, garantindo que partidas de duplas — incluindo de atletas de outros estados na Copa — sejam resolvidas corretamente e apareçam no `/schedule`.

---

## Contexto

A auditoria do evento 3TMB26 identificou 6 pares de duplas com `athleteId: null` em `scorePlayers` (4 linhas no evento 52, 4 no evento 53):

- `JOÃO CARDOSO # JOSÉ PANTALEÃO` (52 — matches 63154, 67032)
- `JAIRO SOUZA # LAUDELINO CALDAS` (52 — match 62662)
- `ALESSANDRO SOUSA # ELDO BARBOSA` (52 — match 62088)
- `ANA SOUZA # LUCAS CARDOSO` (53 — match 66317)
- `DIEGO FERREIRA # MARIA CABRAL` (53 — match 66558)
- `LUCIANA FERREIRA # SAULO BELTRÃO` (53 — matches 66559, 66886)

Consequências: 15 conflitos de atleta não resolvidos (52=10, 53=5), partidas ausentes do `/schedule`.

### Análise de causa raiz — hipótese refinada

A análise do ciclo de vida revelou que os eventos filho 52 e 53 têm divergência persistente de inscrições no `conformanceAudit`:
- Evento 52: `registrationMismatches=11` (92 esperado CBTM vs 51 no banco com `INSCRITO`)
- Evento 53: `registrationMismatches=4` (48 esperado CBTM vs 24 no banco com `INSCRITO`)

Essas divergências persistiram em centenas de runs sem resolução, indicando que são **estruturais para duplas**: metade (ou mais) das duplas tem `registrationStatus != 'INSCRITO'` (provavelmente `PRE_INSCRITO`).

O `conformanceAudit` filtra apenas `INSCRITO` ao verificar inscrições; o pool de resolução `athleteIdsByCategoryId` usa **todos os statuses** (sem filtro). Portanto o pool existe para esses atletas, mas o `resolveMatchAthlete` pode não encontrá-los por outra razão.

**Hipóteses em ordem de probabilidade:**
1. **Divergência de grafia entre inscrição e resultado**: o nome do par na página de inscrições (`"A # B"`) difere do nome na página de resultados (ordem invertida `"B # A"`, abreviação, variação de acento). A função `athleteNameContainsAllReducedTokens` exige que todos os tokens do `shortName` estejam no `nameDisplay` do candidato — uma inversão de par não causaria falha (os tokens são os mesmos), mas uma abreviação sim.
2. **Par ausente do `athleteCategory`**: o par não tem entrada em `athlete_categories` para a categoria específica — pode ocorrer se a inscrição não foi processada corretamente para essa categoria.
3. **Par não foi inscrito formalmente**: aparece nos resultados mas não na lista de inscrições scrapeada.

O diagnóstico no banco (Fase 1) é obrigatório antes de implementar qualquer correção.

---

## Causa raiz

**Imediata:** `resolveMatchAthlete` retorna `null` para 6 pares — causa exata a confirmar via Fase 1.

**Sistêmica:** o pipeline não tem mecanismo de detecção pós-scrape que alerte quando duplas conhecidas ficam sem `athleteId` resolvido, permitindo que o estado persista silenciosamente por semanas.

---

## Cenários funcionais

**DADO** um par de duplas registrado nos eventos 52 ou 53  
**QUANDO** o pipeline resolve `scorePlayers` após o scrape  
**ENTÃO** o par tem `athleteId` preenchido e aparece com 2 `match_participants` no `/schedule`

**DADO** par com grafia de ordem invertida entre inscrição e resultado (`"A # B"` vs `"B # A"`)  
**QUANDO** `resolveMatchAthlete` busca no pool  
**ENTÃO** encontra o par pelo conjunto de tokens (independente de ordem) e resolve o `athleteId`

---

## Critérios de aceitação

1. Diagnóstico (Fase 1): causa confirmada para cada um dos 6 pares
2. Correção (Fase 2, após diagnóstico): próximo scrape resolve os pares identificados
3. `SELECT COUNT(*) FROM athlete_match_conflicts WHERE event_id IN (52,53) AND resolved_athlete_id IS NULL` = 0 após novo scrape
4. Partidas dos 6 pares aparecem no `/schedule` (têm 2 `match_participants`)
5. Atletas individuais (sem `#`) não são afetados — zero regressão

---

## Fora de escopo

- Pares com `registrationStatus = PRE_INSCRITO` sem partidas (orfãos de inscrição) — não são bug
- Partidas de chaveamento (placeholders V1, V2) — ausência do `/schedule` é correta por design
- Frontend — sem alteração de UI
- Schema Prisma — sem DDL

---

## Impacto técnico

### Fase 1 — Diagnóstico (operacional via ssh-oracle, sem código)

**Queries a executar no banco de produção:**

```sql
-- 1. Confirmar o nome exato dos pares com athleteId null
SELECT
  m.id AS match_id,
  m.event_id,
  c.name AS categoria,
  sp->>'name' AS score_player_name
FROM matches m
JOIN categories c ON c.id = m.category_id
CROSS JOIN jsonb_array_elements(m.score_players::jsonb) AS sp
WHERE m.event_id IN (52, 53)
  AND (sp->>'athleteId') IS NULL
  AND c.cbtm_category_id NOT IN ('88888888','99999999')
ORDER BY m.event_id, c.name, sp->>'name';

-- 2. Para cada par não resolvido: buscar em athlete_categories + athletes
-- (substitua <NOME_PARCIAL> pelo sobrenome mais distintivo de cada par)
SELECT a.id, a.name_display, a.name_normalized, ac.registration_status, c.name AS categoria
FROM athletes a
JOIN athlete_categories ac ON ac.athlete_id = a.id
JOIN categories c ON c.id = ac.category_id
WHERE c.event_id IN (52, 53)
  AND upper(a.name_display) LIKE '%<NOME_PARCIAL>%'
ORDER BY a.name_display, c.name;

-- 3. Verificar registration_status dos pares encontrados
SELECT a.name_display, ac.registration_status, c.name AS categoria, c.event_id
FROM athletes a
JOIN athlete_categories ac ON ac.athlete_id = a.id
JOIN categories c ON c.id = ac.category_id
WHERE c.event_id IN (52, 53)
  AND a.name_display LIKE '%#%'
ORDER BY ac.registration_status, a.name_display;

-- 4. Verificar se há conflitos de atleta para esses matches
SELECT amc.id, amc.event_id, amc.context, amc.short_name_normalized,
       amc.resolved_athlete_id,
       jsonb_array_length(amc.candidate_athletes::jsonb -> 'candidates') AS n_candidatos
FROM athlete_match_conflicts amc
WHERE amc.event_id IN (52, 53)
  AND amc.resolved_athlete_id IS NULL
ORDER BY amc.event_id, amc.context;
```

O Codex deve reportar para cada par:
- Nome exato em `scorePlayers`
- Existe em `athletes` + `athlete_categories`? Com qual `registration_status`?
- Existe em `athlete_match_conflicts`? Com quantos candidatos?
- Hipótese de causa (grafia divergente / ausente do banco / sem candidatos no pool)

### Fase 2 — Correção no código (após diagnóstico aprovado por Leo)

**Arquivos a modificar** — definidos após diagnóstico. Lista preliminar:

**Cenário A (mais provável — divergência de grafia/abreviação):**

`apps/worker/src/pipeline/upsert.service.ts` — função `resolveMatchAthlete` (~linha 3412)

Quando `shortName` contém `#` (par de duplas) e nenhum candidato é encontrado pelo algoritmo atual, tentar match por subconjunto de tokens de cada membro do par separadamente:

```ts
// Se shortName é par de duplas e não resolveu, tentar por cada membro individualmente
if (!resolvedAthlete && shortName.includes('#')) {
  const parts = splitDoublesPairParts(shortName);
  // tentar encontrar atleta cujo nameDisplay contém tokens de ambas as partes
  // (já normalizado — '#' vira espaço em normalizeAthleteName)
}
```

**Cenário B (ausência de athlete_category):**

Investigar por que o par não foi inserido em `athlete_categories` — pode ser bug no sync de registrations para duplas com `PRE_INSCRITO`.

**Arquivos que NÃO devem ser tocados** (Fase 2):
- `packages/parser/` — PP-008 já resolveu o parsing
- `apps/api/`, `apps/web/`
- Schema Prisma

---

## Plano de testes

### Cobertura geral

Fase 1: sem testes automatizados — apenas queries de diagnóstico.  
Fase 2: unitário em `upsert.service.ts` (função de resolução).

### T-U-01 — resolução direta de par (regressão — não deve quebrar)

Camada: unitário  
DADO: `shortName = "JOÃO CARDOSO # JOSÉ PANTALEÃO"` e pool contendo athlete com `nameDisplay = "JOÃO CARDOSO # JOSÉ PANTALEÃO"`  
QUANDO: resolução executada  
ENTÃO: retorna o athlete correto (não null)

### T-U-02 — resolução de par com grafia divergente (novo comportamento)

_(Cenário e implementação definidos após Fase 1 confirmar a causa)_

### T-U-03 — atletas individuais sem `#` não são afetados

DADO: `shortName = "CARLOS SILVA"` e pool com atletas individuais  
QUANDO: resolução executada  
ENTÃO: comportamento idêntico ao atual — nenhuma regressão

### Comando para rodar a suite

```
npm --prefix apps/worker test
```

---

## Sequência de entrega

**Fase 1 (Diagnóstico — sem código):**
- Codex executa as queries via ssh-oracle (leitura apenas)
- Codex reporta causa por par
- Claude analisa, confirma hipótese, atualiza spec para Fase 2
- Leo aprova Fase 2

**Fase 2 (Correção — somente após Fase 1 aprovada):**
- Codex implementa T-U-01, T-U-02 (definido após diagnóstico), T-U-03 em Red-Green
- Claude revisa

---

## Orientação para o Codex — Fase 1

```
## Orientação para o Codex — PP-011 Fase 1 — Diagnóstico

### Objetivo
Diagnosticar causa raiz de athleteId: null para 6 pares de duplas nos eventos 52 e 53.
Apenas leitura no banco de produção. Nenhum código alterado, nenhum arquivo commitado.

### Servidor
ubuntu@129.213.86.180
Chave SSH: ~/Documents/estudos/ssh-keys/pingpongpaidegua/ssh-key-2026-04-02.key
Banco: -d cbtm (não -d pingpong)
Container: pingpongpaidegua-postgres-1

### Pares a investigar
52: JOÃO CARDOSO # JOSÉ PANTALEÃO | JAIRO SOUZA # LAUDELINO CALDAS | ALESSANDRO SOUSA # ELDO BARBOSA
53: ANA SOUZA # LUCAS CARDOSO | DIEGO FERREIRA # MARIA CABRAL | LUCIANA FERREIRA # SAULO BELTRÃO

### Passo 1 — confirmar nomes exatos em scorePlayers
```bash
docker exec pingpongpaidegua-postgres-1 psql -U postgres -d cbtm -c "
SELECT m.id AS match_id, m.event_id, c.name AS categoria, sp->>'name' AS nome_par
FROM matches m
JOIN categories c ON c.id = m.category_id
CROSS JOIN jsonb_array_elements(m.score_players::jsonb) AS sp
WHERE m.event_id IN (52, 53)
  AND (sp->>'athleteId') IS NULL
  AND c.cbtm_category_id NOT IN ('88888888','99999999')
ORDER BY m.event_id, sp->>'name';"
```

### Passo 2 — buscar cada par no banco por sobrenome distintivo
Para cada par, executar (substitua os sobrenomes):
```bash
docker exec pingpongpaidegua-postgres-1 psql -U postgres -d cbtm -c "
SELECT a.id, a.name_display, a.name_normalized, ac.registration_status, c.name AS cat, c.event_id
FROM athletes a
JOIN athlete_categories ac ON ac.athlete_id = a.id
JOIN categories c ON c.id = ac.category_id
WHERE c.event_id IN (52, 53)
  AND (upper(a.name_display) LIKE '%CARDOSO%' OR upper(a.name_display) LIKE '%PANTALEAO%')
ORDER BY a.name_display;"
```
Repetir para cada par (SOUZA+LAUDELINO, SOUSA+ELDO, ANA+LUCAS, DIEGO+CABRAL, LUCIANA+SAULO).

### Passo 3 — verificar conflitos pendentes
```bash
docker exec pingpongpaidegua-postgres-1 psql -U postgres -d cbtm -c "
SELECT amc.id, amc.event_id, amc.context, amc.short_name_normalized,
       amc.resolved_athlete_id,
       (amc.candidate_athletes::jsonb -> 'candidates') AS candidatos
FROM athlete_match_conflicts amc
WHERE amc.event_id IN (52, 53)
  AND amc.resolved_athlete_id IS NULL
ORDER BY amc.event_id, amc.context;"
```

### Passo 4 — listar todos os atletas de duplas com seu registration_status
```bash
docker exec pingpongpaidegua-postgres-1 psql -U postgres -d cbtm -c "
SELECT a.name_display, ac.registration_status, c.name AS cat
FROM athletes a
JOIN athlete_categories ac ON ac.athlete_id = a.id
JOIN categories c ON c.id = ac.category_id
WHERE c.event_id IN (52, 53)
  AND a.name_display LIKE '%#%'
  AND c.cbtm_category_id NOT IN ('88888888','99999999')
ORDER BY ac.registration_status, a.name_display;"
```

### Reportar por par
Para cada um dos 6 pares:
1. Nome exato em scorePlayers (Passo 1)
2. Encontrado em athletes+athlete_categories? (Passo 2) — com qual registration_status?
3. Existe em athlete_match_conflicts? Com quantos candidatos? (Passo 3)
4. Hipótese: grafia divergente / ausente do banco / sem candidatos no pool

### Restrições
- Apenas SELECT no banco
- Não acionar scrape
- Não alterar código nem arquivos do repositório
```
