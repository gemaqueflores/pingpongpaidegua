-- AlterTable
ALTER TABLE "events" ADD COLUMN "scrape_locked_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "scrape_runs" ADD COLUMN "extraction_stats" JSONB NOT NULL DEFAULT '{}';