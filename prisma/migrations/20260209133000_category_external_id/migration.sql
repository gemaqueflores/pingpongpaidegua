-- AlterTable
ALTER TABLE "categories" ADD COLUMN "cbtm_category_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "categories_event_id_cbtm_category_id_key" ON "categories"("event_id", "cbtm_category_id");
