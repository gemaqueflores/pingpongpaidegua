-- CreateTable
CREATE TABLE "event_athlete_links" (
    "id" SERIAL NOT NULL,
    "event_id" INTEGER NOT NULL,
    "athlete_id" INTEGER,
    "athlete_key" TEXT NOT NULL,
    "athlete_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_athlete_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "event_athlete_links_event_id_athlete_key_key"
ON "event_athlete_links"("event_id", "athlete_key");

-- CreateIndex
CREATE UNIQUE INDEX "event_athlete_links_event_id_athlete_id_key"
ON "event_athlete_links"("event_id", "athlete_id");

-- CreateIndex
CREATE INDEX "event_athlete_links_athlete_id_idx"
ON "event_athlete_links"("athlete_id");

-- CreateIndex
CREATE INDEX "event_athlete_links_event_id_athlete_id_idx"
ON "event_athlete_links"("event_id", "athlete_id");

-- AddForeignKey
ALTER TABLE "event_athlete_links"
ADD CONSTRAINT "event_athlete_links_event_id_fkey"
FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_athlete_links"
ADD CONSTRAINT "event_athlete_links_athlete_id_fkey"
FOREIGN KEY ("athlete_id") REFERENCES "athletes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
