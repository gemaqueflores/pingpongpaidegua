DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'EventLevel') THEN
    CREATE TYPE "EventLevel" AS ENUM ('ESTADUAL', 'COPA', 'NACIONAL');
  END IF;
END $$;

ALTER TABLE "events"
  ADD COLUMN IF NOT EXISTS "nivel" "EventLevel",
  ADD COLUMN IF NOT EXISTS "inicio_inscricoes" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "fim_inscricoes" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "inicio_realizacao" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "fim_realizacao" TIMESTAMP(3);

ALTER TABLE "matches"
  ADD COLUMN IF NOT EXISTS "cbtm_match_id" TEXT,
  ADD COLUMN IF NOT EXISTS "source_flags" JSONB;

CREATE INDEX IF NOT EXISTS "matches_cbtm_match_id_idx" ON "matches"("cbtm_match_id");
