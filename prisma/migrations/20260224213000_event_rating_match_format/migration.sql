-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "RatingMatchFormat" AS ENUM ('RR_K1', 'K1');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AlterTable
ALTER TABLE "events"
ADD COLUMN IF NOT EXISTS "rating_match_format" "RatingMatchFormat" NOT NULL DEFAULT 'RR_K1';
