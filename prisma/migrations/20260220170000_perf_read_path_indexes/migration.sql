-- CreateIndex
CREATE INDEX "athletes_event_id_created_from_warning_name_display_idx"
ON "athletes"("event_id", "created_from_warning", "name_display");

-- CreateIndex
CREATE INDEX "categories_event_id_cbtm_category_id_idx"
ON "categories"("event_id", "cbtm_category_id");

-- CreateIndex
CREATE INDEX "matches_event_id_phase_idx"
ON "matches"("event_id", "phase");

-- CreateIndex
CREATE INDEX "scrape_runs_event_id_status_started_at_idx"
ON "scrape_runs"("event_id", "status", "started_at");
