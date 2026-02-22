-- CreateTable
CREATE TABLE "read_model_caches" (
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "event_id" INTEGER NOT NULL,
    "athlete_id" INTEGER,
    "source_scrape_run_id" INTEGER,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "read_model_caches_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "read_model_caches_event_id_kind_idx" ON "read_model_caches"("event_id", "kind");

-- CreateIndex
CREATE INDEX "read_model_caches_event_id_athlete_id_kind_idx" ON "read_model_caches"("event_id", "athlete_id", "kind");

-- CreateIndex
CREATE INDEX "athlete_categories_category_id_athlete_id_registration_status_idx"
ON "athlete_categories"("category_id", "athlete_id", "registration_status");

-- CreateIndex
CREATE INDEX "matches_event_id_category_id_phase_match_datetime_idx"
ON "matches"("event_id", "category_id", "phase", "match_datetime");

-- CreateIndex
CREATE INDEX "match_participants_athlete_id_match_id_idx"
ON "match_participants"("athlete_id", "match_id");

-- AddForeignKey
ALTER TABLE "read_model_caches"
ADD CONSTRAINT "read_model_caches_event_id_fkey"
FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
