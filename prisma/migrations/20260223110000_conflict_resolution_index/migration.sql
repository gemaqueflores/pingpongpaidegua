-- Index para consultas de conflitos pendentes/ordenacao por data
CREATE INDEX IF NOT EXISTS "athlete_match_conflicts_event_id_resolved_at_created_at_idx"
  ON "athlete_match_conflicts" ("event_id", "resolved_at", "created_at");