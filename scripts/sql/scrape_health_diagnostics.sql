-- Diagnostico rapido de saude do ciclo scrape/pós-scrape.
-- Uso: psql "$DATABASE_URL" -f scripts/sql/scrape_health_diagnostics.sql

-- 1) Ultimos runs por evento
SELECT
  sr.event_id,
  e.nome AS event_name,
  sr.id AS scrape_run_id,
  sr.started_at,
  sr.finished_at,
  sr.status,
  COALESCE(jsonb_array_length(sr.warnings::jsonb), 0) AS warnings_count
FROM scrape_runs sr
JOIN events e ON e.id = sr.event_id
ORDER BY sr.started_at DESC
LIMIT 200;

-- 2) Backlog de conflitos pendentes por evento
SELECT
  amc.event_id,
  e.nome AS event_name,
  COUNT(*) AS unresolved_conflicts
FROM athlete_match_conflicts amc
JOIN events e ON e.id = amc.event_id
WHERE amc.resolved_athlete_id IS NULL
GROUP BY amc.event_id, e.nome
ORDER BY unresolved_conflicts DESC, amc.event_id ASC;

-- 3) Conflitos criados nas ultimas 24h (pendentes e resolvidos)
SELECT
  amc.event_id,
  COUNT(*) FILTER (WHERE amc.resolved_athlete_id IS NULL) AS unresolved_24h,
  COUNT(*) FILTER (WHERE amc.resolved_athlete_id IS NOT NULL) AS resolved_24h
FROM athlete_match_conflicts amc
WHERE amc.created_at >= NOW() - INTERVAL '24 hours'
GROUP BY amc.event_id
ORDER BY unresolved_24h DESC, resolved_24h DESC;

-- 4) Capturas DX por aba nas ultimas 24h
SELECT
  rc.event_id,
  rc.tab,
  COUNT(*) AS captures
FROM raw_captures rc
WHERE rc.captured_at >= NOW() - INTERVAL '24 hours'
GROUP BY rc.event_id, rc.tab
ORDER BY rc.event_id ASC, rc.tab ASC;

-- 5) Eventos com lock potencialmente orfao (mais de 45 min)
SELECT
  e.id AS event_id,
  e.nome AS event_name,
  e.scrape_locked_at,
  EXTRACT(EPOCH FROM (NOW() - e.scrape_locked_at)) / 60 AS lock_age_minutes
FROM events e
WHERE e.scrape_locked_at IS NOT NULL
  AND e.scrape_locked_at < NOW() - INTERVAL '45 minutes'
ORDER BY e.scrape_locked_at ASC;

-- 6) Autofix de conflitos por estrategia (ultimas 24h)
SELECT
  amc.event_id,
  COALESCE(amc.candidate_athletes->'postScrapeAutofix'->>'strategy', 'manual_or_none') AS strategy,
  COUNT(*) AS total
FROM athlete_match_conflicts amc
WHERE amc.resolved_at >= NOW() - INTERVAL '24 hours'
GROUP BY amc.event_id, strategy
ORDER BY amc.event_id ASC, total DESC;
