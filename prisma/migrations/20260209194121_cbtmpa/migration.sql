-- DropForeignKey
ALTER TABLE "athlete_aliases" DROP CONSTRAINT "athlete_aliases_athlete_id_fkey";

-- DropForeignKey
ALTER TABLE "athlete_match_conflicts" DROP CONSTRAINT "athlete_match_conflicts_event_id_fkey";

-- AddForeignKey
ALTER TABLE "athlete_aliases" ADD CONSTRAINT "athlete_aliases_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "athletes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "athlete_match_conflicts" ADD CONSTRAINT "athlete_match_conflicts_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "athlete_match_conflicts_event_id_context_short_name_normalized_" RENAME TO "athlete_match_conflicts_event_id_context_short_name_normali_key";
