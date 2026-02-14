-- CreateIndex
CREATE INDEX "athletes_event_id_club_id_idx" ON "athletes"("event_id", "club_id");

-- CreateIndex
CREATE INDEX "athletes_event_id_name_display_idx" ON "athletes"("event_id", "name_display");

-- CreateIndex
CREATE INDEX "matches_event_id_category_id_match_datetime_idx" ON "matches"("event_id", "category_id", "match_datetime");

-- CreateIndex
CREATE INDEX "scrape_runs_event_id_started_at_idx" ON "scrape_runs"("event_id", "started_at");

-- CreateIndex
CREATE INDEX "raw_captures_event_id_scrape_run_id_captured_at_idx" ON "raw_captures"("event_id", "scrape_run_id", "captured_at");

-- Trigram extension for contains/insensitive search optimization
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram indexes
CREATE INDEX "athletes_name_display_trgm_idx" ON "athletes" USING GIN ("name_display" gin_trgm_ops);
CREATE INDEX "clubs_name_trgm_idx" ON "clubs" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "categories_name_trgm_idx" ON "categories" USING GIN ("name" gin_trgm_ops);

