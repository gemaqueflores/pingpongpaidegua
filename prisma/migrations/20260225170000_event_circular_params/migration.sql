-- CreateEnum
CREATE TYPE "SeedCriteria" AS ENUM ('AUTO', 'RANKING', 'RATING');

-- AlterTable
ALTER TABLE "events"
  ADD COLUMN "seed_criteria" "SeedCriteria" NOT NULL DEFAULT 'AUTO',
  ADD COLUMN "group_best_of_sets" INTEGER,
  ADD COLUMN "elimination_best_of_sets" INTEGER,
  ADD COLUMN "allow_cobra_adjustments" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "allow_byes" BOOLEAN NOT NULL DEFAULT true;
