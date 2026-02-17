CREATE TABLE IF NOT EXISTS "event_merges" (
  "id" SERIAL PRIMARY KEY,
  "primary_event_id" INTEGER NOT NULL,
  "secondary_event_id" INTEGER NOT NULL,
  "category_suffix" TEXT NOT NULL DEFAULT ' -X',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "event_merges_primary_event_id_fkey"
    FOREIGN KEY ("primary_event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "event_merges_secondary_event_id_fkey"
    FOREIGN KEY ("secondary_event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "event_merges_primary_event_id_secondary_event_id_key" UNIQUE ("primary_event_id", "secondary_event_id"),
  CONSTRAINT "event_merges_secondary_event_id_key" UNIQUE ("secondary_event_id")
);

CREATE INDEX IF NOT EXISTS "event_merges_primary_event_id_idx" ON "event_merges"("primary_event_id");
