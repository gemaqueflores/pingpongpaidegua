-- CreateEnum
CREATE TYPE "SyncMode" AS ENUM ('INCREMENTAL', 'FULL_EVENT_REBUILD');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('SUCCESS', 'ERROR');

-- CreateTable
CREATE TABLE "event_sync_state" (
    "event_id" INTEGER NOT NULL,
    "last_published_at" TIMESTAMP(3),
    "last_source_scrape_run_id" INTEGER,
    "last_status" "SyncStatus",
    "last_error_message" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_sync_state_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "event_sync_runs" (
    "id" SERIAL NOT NULL,
    "event_id" INTEGER NOT NULL,
    "source_scrape_run_id" INTEGER,
    "mode" "SyncMode" NOT NULL,
    "status" "SyncStatus" NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "inserted_counts" JSONB NOT NULL DEFAULT '{}',
    "updated_counts" JSONB NOT NULL DEFAULT '{}',
    "deleted_counts" JSONB NOT NULL DEFAULT '{}',
    "error_message" TEXT,

    CONSTRAINT "event_sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "event_sync_runs_event_id_started_at_idx" ON "event_sync_runs"("event_id", "started_at");

-- AddForeignKey
ALTER TABLE "event_sync_state" ADD CONSTRAINT "event_sync_state_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_sync_runs" ADD CONSTRAINT "event_sync_runs_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

