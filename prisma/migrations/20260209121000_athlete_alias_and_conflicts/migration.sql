-- CreateEnum
CREATE TYPE "AliasSource" AS ENUM ('INSCRICOES', 'JOGOS');

-- AlterTable
ALTER TABLE "athletes" RENAME COLUMN "name" TO "name_display";
ALTER TABLE "athletes" RENAME COLUMN "normalized_name" TO "name_normalized";
ALTER TABLE "athletes" ADD COLUMN "ranking_points" INTEGER;
ALTER TABLE "athletes" ADD COLUMN "rating_points" INTEGER;

-- DropIndex
DROP INDEX "athletes_event_id_normalized_name_club_id_key";

-- CreateIndex
CREATE UNIQUE INDEX "athletes_event_id_name_normalized_club_id_key" ON "athletes"("event_id", "name_normalized", "club_id");

-- CreateTable
CREATE TABLE "athlete_aliases" (
    "id" SERIAL NOT NULL,
    "athlete_id" INTEGER NOT NULL,
    "alias_display" TEXT NOT NULL,
    "alias_normalized" TEXT NOT NULL,
    "source" "AliasSource" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "athlete_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "athlete_match_conflicts" (
    "id" SERIAL NOT NULL,
    "event_id" INTEGER NOT NULL,
    "context" TEXT NOT NULL,
    "short_name" TEXT NOT NULL,
    "short_name_normalized" TEXT NOT NULL,
    "candidate_athletes" JSONB NOT NULL,
    "resolved_athlete_id" INTEGER,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "athlete_match_conflicts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "athlete_aliases_athlete_id_alias_normalized_key" ON "athlete_aliases"("athlete_id", "alias_normalized");

-- CreateIndex
CREATE INDEX "athlete_aliases_alias_normalized_idx" ON "athlete_aliases"("alias_normalized");

-- CreateIndex
CREATE UNIQUE INDEX "athlete_match_conflicts_event_id_context_short_name_normalized_key" ON "athlete_match_conflicts"("event_id", "context", "short_name_normalized");

-- CreateIndex
CREATE INDEX "athlete_match_conflicts_event_id_resolved_athlete_id_idx" ON "athlete_match_conflicts"("event_id", "resolved_athlete_id");

-- AddForeignKey
ALTER TABLE "athlete_aliases" ADD CONSTRAINT "athlete_aliases_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "athletes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "athlete_match_conflicts" ADD CONSTRAINT "athlete_match_conflicts_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "athlete_match_conflicts" ADD CONSTRAINT "athlete_match_conflicts_resolved_athlete_id_fkey" FOREIGN KEY ("resolved_athlete_id") REFERENCES "athletes"("id") ON DELETE SET NULL ON UPDATE CASCADE;