ALTER TABLE "matches"
  ADD COLUMN "sets_json" JSONB,
  ADD COLUMN "p1_sets" INTEGER,
  ADD COLUMN "p2_sets" INTEGER,
  ADD COLUMN "winner_index" INTEGER,
  ADD COLUMN "score_players" JSONB,
  ADD COLUMN "source_url" TEXT,
  ADD COLUMN "fetched_at" TIMESTAMP(3);
