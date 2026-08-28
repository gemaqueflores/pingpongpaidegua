# PP-038 — Auditoria de completude dos 23 eventos antes de qualquer limpeza de raw_captures

## Status: análise/investigação read-only — sem Spec de limpeza até esta auditoria confirmar completude

## Objetivo

Confirmar, evento por evento (23 eventos persistidos), que os dados estruturados já capturados
(categorias, inscrições, partidas, placares) estão completos e corretos, **antes** de autorizar qualquer
limpeza retroativa de `RawCapture` — alguns eventos não são recapturáveis (competição já encerrada, fonte
CBTM pode não estar mais disponível), então uma purga que revele lacuna depois não tem como ser corrigida
via reprocessamento do HTML bruto.

## Contexto técnico (confirmado por leitura de código)

- **Placares já são independentes de `RawCapture`:** `Match.scoreSets`, `Match.scoreFinal`,
  `Match.p1Sets`/`p2Sets`, `Match.scoreRaw` (`prisma/schema.prisma:218-254`) são campos próprios,
  preenchidos no `upsert`, sem relação de leitura com `RawCapture`. Confirmado: nenhum consumidor em
  `apps/api` lê `RawCapture` de volta — só o worker escreve.
- **`RawCapture` guarda o HTML/dado bruto do scraping** (`rawBody`, `htmlBody`,
  `prisma/schema.prisma:342-358`), útil para auditoria/debug de parsing ou reprocessamento manual, não
  para servir dado à aplicação.
- **Já existe material de auditoria de completude por run:** `ScrapeRun.extractionStats.conformanceAudit`
  (`apps/worker/src/pipeline/scrape.processor.ts:77-94`) — `categoryCountExpected/Observed`,
  `expectedMatchesTotal/observedMatchesTotal`, `expectedPlayedMatchesTotal/observedPlayedMatchesTotal`,
  `expectedRegistrationsTotal/observedRegistrationsTotal`, `pendingConflicts`,
  `athleteCategoryRuleViolations`. Essa é a fonte primária para a auditoria — não precisa reinventar
  métrica nova.
- **Retenção já ativa hoje:** `RawCaptureRetentionService` (`apps/api/src/admin/raw-capture-retention.service.ts`)
  já apaga `RawCapture` de runs `SUCCESS` além de `maxRunsPerEvent`/`successDays` (defaults: 20 runs, 14
  dias). A lacuna real é `RAW_CAPTURE_RETENTION_DAYS_ERROR=0` — mantém indefinidamente captures de runs
  `PARTIAL`/`ERROR`, causa provável de `raw_captures` ser ~95% do banco.

## Plano de auditoria (read-only, via Codex/SSH)

### Passo 1 — snapshot de conformidade do run mais recente por evento

```sql
SELECT
  sr.event_id,
  e.cbtm_event_id,
  e.nome,
  sr.id AS run_id,
  sr.status,
  sr.started_at,
  sr.extraction_stats -> 'conformanceAudit' ->> 'categoryCountExpected' AS cat_esperada,
  sr.extraction_stats -> 'conformanceAudit' ->> 'categoryCountObserved' AS cat_observada,
  sr.extraction_stats -> 'conformanceAudit' ->> 'expectedMatchesTotal' AS partidas_esperadas,
  sr.extraction_stats -> 'conformanceAudit' ->> 'observedMatchesTotal' AS partidas_observadas,
  sr.extraction_stats -> 'conformanceAudit' ->> 'expectedPlayedMatchesTotal' AS jogadas_esperadas,
  sr.extraction_stats -> 'conformanceAudit' ->> 'observedPlayedMatchesTotal' AS jogadas_observadas,
  sr.extraction_stats -> 'conformanceAudit' ->> 'pendingConflicts' AS conflitos_pendentes,
  sr.extraction_stats -> 'conformanceAudit' ->> 'athleteCategoryRuleViolations' AS violacoes_vinculo
FROM scrape_runs sr
JOIN events e ON e.id = sr.event_id
WHERE sr.id IN (
  SELECT MAX(id) FROM scrape_runs GROUP BY event_id
)
ORDER BY e.cbtm_event_id;
```

### Passo 2 — confirmar completude estrutural direto nas tabelas de dado (não só o que o run reportou)

```sql
-- Partidas sem placar em evento marcado como concluído
SELECT e.id, e.cbtm_event_id, e.nome, COUNT(*) AS partidas_sem_placar
FROM matches m
JOIN events e ON e.id = m.event_id
WHERE e.concluido = true
  AND m.phase = 'RESULTADOS'
  AND m.score_raw IS NULL
  AND m.p1_sets IS NULL
GROUP BY e.id, e.cbtm_event_id, e.nome
HAVING COUNT(*) > 0
ORDER BY partidas_sem_placar DESC;

-- Conflitos de atleta ainda pendentes, por evento
SELECT e.id, e.cbtm_event_id, e.nome, COUNT(*) AS conflitos_pendentes
FROM athlete_match_conflicts amc
JOIN events e ON e.id = amc.event_id
GROUP BY e.id, e.cbtm_event_id, e.nome
HAVING COUNT(*) > 0
ORDER BY conflitos_pendentes DESC;
```

### Passo 3 — classificação de risco por evento

Para cada um dos 23 eventos, classificar como:
- **Verde (seguro para limpeza):** último `conformanceAudit` com `categoryCountExpected ==
  categoryCountObserved`, `expectedMatchesTotal <= observedMatchesTotal` (ou igual),
  `pendingConflicts == 0`, zero partidas de `RESULTADOS` sem placar.
- **Amarelo (revisar antes):** pequenas divergências (ex.: `pendingConflicts > 0` mas baixo, ou
  `athleteCategoryRuleViolations > 0`) — Leo decide caso a caso se aceita ou exige nova captura antes de
  limpar `RawCapture` desse evento específico.
- **Vermelho (não limpar ainda):** divergência relevante entre esperado/observado, partidas sem placar em
  evento concluído, ou conflitos pendentes numerosos — sinal de que o dado estruturado pode estar
  incompleto, e `RawCapture` ainda é a única forma de auditar/corrigir manualmente se necessário.

## Critérios de aceitação desta rodada

- Relatório com os 23 eventos classificados (verde/amarelo/vermelho), com os números reais de
  completude por evento — não apenas o agregado já visto no CAT PP-036.
- Nenhuma escrita/exclusão nesta rodada — só leitura.
- Para eventos amarelos/vermelhos: registrar explicitamente o que falta (ex.: "run mais recente é
  PARTIAL, categorias observadas 38/40") para Leo decidir se recaptura antes de considerar limpeza.

## Rodada 2 — correção de metodologia (contraponto aceito)

**Achado:** dos 17 eventos classificados "vermelho" pela Rodada 1, **12 estão vermelhos apenas por
ausência de `conformanceAudit`** (`4849`, `4953`, `5131`, `5246`, `5368`, `5468`, `5476`, `5477`, `5542`,
`5688`, `5691`, `5827`), não por evidência real de dado incompleto. Confirmado por `git log`:
`conformanceAudit` foi
introduzido no commit `9095647` (22/02/2026) — eventos capturados antes disso nunca tiveram essa métrica
calculada, independente de estarem completos ou não. Tratar "métrica ausente" e "déficit real medido"
com a mesma cor mistura duas causas completamente diferentes.

**Correção:** segunda verificação independente, sem depender de `conformanceAudit`, para os eventos hoje
vermelhos só por ausência dessa métrica — usando sinais estruturais já persistidos no próprio dado
(mesmo padrão de proxy já usado no CAT PP-020 para achar categorias órfãs).

### Queries da 2ª verificação (read-only)

```sql
-- Para cada evento "vermelho por ausência de auditoria": categorias sem nenhuma partida
SELECT e.id, e.cbtm_event_id, e.nome, c.id AS category_id, c.name AS categoria,
       COUNT(m.id) AS total_partidas
FROM categories c
JOIN events e ON e.id = c.event_id
LEFT JOIN matches m ON m.category_id = c.id
WHERE e.cbtm_event_id IN (4849, 4953, 5131, 5246, 5368, 5468, 5476, 5477, 5542, 5688, 5691, 5827)
GROUP BY e.id, e.cbtm_event_id, e.nome, c.id, c.name
HAVING COUNT(m.id) = 0
ORDER BY e.cbtm_event_id;

-- Categorias com atletas inscritos mas nenhum resultado (RESULTADOS) publicado
SELECT e.id, e.cbtm_event_id, e.nome, c.id AS category_id, c.name AS categoria,
       COUNT(DISTINCT ac.athlete_id) AS atletas_inscritos,
       COUNT(m.id) FILTER (WHERE m.phase = 'RESULTADOS') AS partidas_resultado
FROM categories c
JOIN events e ON e.id = c.event_id
LEFT JOIN athlete_categories ac ON ac.category_id = c.id AND ac.registration_status = 'INSCRITO'
LEFT JOIN matches m ON m.category_id = c.id
WHERE e.cbtm_event_id IN (4849, 4953, 5131, 5246, 5368, 5468, 5476, 5477, 5542, 5688, 5691, 5827)
GROUP BY e.id, e.cbtm_event_id, e.nome, c.id, c.name
HAVING COUNT(DISTINCT ac.athlete_id) >= 3 AND COUNT(m.id) FILTER (WHERE m.phase = 'RESULTADOS') = 0
ORDER BY e.cbtm_event_id;

-- lastScrapeAt muito antigo apesar de concluido=true (sinal de captura abandonada, não finalizada)
SELECT id, cbtm_event_id, nome, concluido, last_scrape_at, data_fim
FROM events
WHERE cbtm_event_id IN (4849, 4953, 5131, 5246, 5368, 5468, 5476, 5477, 5542, 5688, 5691, 5827)
ORDER BY cbtm_event_id;
```

**Reclassificação proposta após a 2ª verificação:**
- Se nenhuma categoria com zero partidas E nenhuma categoria com atletas-sem-resultado for encontrada:
  reclassificar de vermelho para **verde** (dado estruturalmente completo, só sem a métrica nova).
- Se alguma categoria vazia/sem resultado for encontrada: permanece **vermelho** (ou amarelo, conforme
  volume) — agora com evidência real, não por ausência de métrica.

**Eventos que permanecem vermelho por déficit real medido, já confirmado na Rodada 1 (não precisam da 2ª
verificação):** `4868` (78 esperadas/59 observadas), `4963` (58/46), `5159` (47/28), `5828` (201/124),
`6013` (101/0 partidas). Esses têm evidência direta de captura incompleta, independente do
`conformanceAudit` existir ou não.

**Casos à parte, fora da reclassificação automática:**
- `5680` e `5826`: observações muito acima do esperado (inflação, não déficit) — o próprio Codex já
  sinalizou que merecem atenção antes de qualquer decisão, mesmo satisfazendo o critério literal
  `esperadas <= observadas`. Tratar como pendência de investigação própria (possível duplicação
  residual, tema já parcialmente coberto por PP-021).
- `5826` também tem 10 conflitos e 57 violações de vínculo — mantém-se amarelo/atenção mesmo após a 2ª
  verificação.
- `6054`: `conformanceAudit` com esperado e observado ambos zerados — ambíguo (pode ser evento sem
  partidas registradas ainda, não necessariamente incompleto); fora da coorte original dos 23, avaliar
  separadamente.

## Fora de escopo desta rodada

- Não formular a Spec de limpeza propriamente dita (correção de `RAW_CAPTURE_RETENTION_DAYS_ERROR` +
  execução da retenção já existente) — isso vem **depois** desta auditoria confirmar que os eventos
  vermelhos/amarelos foram resolvidos ou aceitos explicitamente por Leo.
- Não alterar `RawCaptureRetentionService` nem rodar `cleanup()` (mesmo em dry-run) nesta rodada — é só
  leitura direta via SQL, não a execução do serviço.
