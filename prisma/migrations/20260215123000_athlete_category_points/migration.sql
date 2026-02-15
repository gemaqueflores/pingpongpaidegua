ALTER TABLE "athlete_categories"
ADD COLUMN IF NOT EXISTS "ranking_points" INTEGER,
ADD COLUMN IF NOT EXISTS "rating_points" INTEGER;

