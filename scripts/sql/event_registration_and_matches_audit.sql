-- Uso (psql):
--   \set event_id 5368
--   \i scripts/sql/event_registration_and_matches_audit.sql

WITH scoped_event AS (
  SELECT id
  FROM events
  WHERE cbtm_event_id = :event_id
),
valid_categories AS (
  SELECT c.id, c.cbtm_category_id
  FROM categories c
  JOIN scoped_event e ON e.id = c.event_id
),
athlete_category_links AS (
  SELECT ac.athlete_id, ac.category_id, vc.cbtm_category_id
  FROM athlete_categories ac
  JOIN valid_categories vc ON vc.id = ac.category_id
),
athlete_category_only AS (
  SELECT *
  FROM athlete_category_links
  WHERE COALESCE(cbtm_category_id, '') NOT IN ('88888888', '99999999')
),
technician_club_only AS (
  SELECT *
  FROM athlete_category_links
  WHERE cbtm_category_id = '99999999'
),
participants_unique AS (
  SELECT COUNT(DISTINCT a.name_normalized) AS total
  FROM athletes a
  JOIN scoped_event e ON e.id = a.event_id
  WHERE a.created_from_warning = FALSE
),
matches_total AS (
  SELECT COUNT(*) AS total
  FROM matches m
  JOIN scoped_event e ON e.id = m.event_id
),
matches_with_winner_or_sets AS (
  SELECT COUNT(*) AS total
  FROM matches m
  JOIN scoped_event e ON e.id = m.event_id
  WHERE m.winner_index IS NOT NULL
     OR m.p1_sets IS NOT NULL
     OR m.p2_sets IS NOT NULL
)
SELECT
  :event_id::int AS cbtm_event_id,
  (SELECT COUNT(*) FROM athlete_category_only) AS associacoes_atleta_categoria,
  (SELECT COUNT(*) FROM technician_club_only) AS associacoes_tecnico_clube,
  (SELECT COUNT(*) FROM athlete_category_only) + (SELECT COUNT(*) FROM technician_club_only) AS inscricoes_totais_oficiais,
  (SELECT total FROM participants_unique) AS participantes_unicos,
  (SELECT total FROM matches_total) AS jogos_total_persistidos,
  (SELECT total FROM matches_with_winner_or_sets) AS jogos_com_resultado_registrado;
