-- CreateEnum
CREATE TYPE "CompetitionFormat" AS ENUM ('AUTO', 'K1');

-- AlterTable
ALTER TABLE "events"
ADD COLUMN "competition_format" "CompetitionFormat" NOT NULL DEFAULT 'AUTO';
