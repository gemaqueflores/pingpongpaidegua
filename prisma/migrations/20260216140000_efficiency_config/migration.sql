CREATE TABLE IF NOT EXISTS "efficiency_config" (
  "id" INTEGER NOT NULL,
  "peso_ouro" INTEGER NOT NULL DEFAULT 400,
  "peso_prata" INTEGER NOT NULL DEFAULT 240,
  "peso_bronze" INTEGER NOT NULL DEFAULT 120,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "efficiency_config_pkey" PRIMARY KEY ("id")
);

INSERT INTO "efficiency_config" ("id", "peso_ouro", "peso_prata", "peso_bronze", "created_at", "updated_at")
VALUES (1, 400, 240, 120, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
