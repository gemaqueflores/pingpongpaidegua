CREATE TABLE "efficiency_config_version" (
  "id" SERIAL NOT NULL,
  "data_inicio_vigencia" TIMESTAMP(3) NOT NULL,
  "data_fim_vigencia" TIMESTAMP(3),
  "peso_ouro" INTEGER NOT NULL DEFAULT 130,
  "peso_prata" INTEGER NOT NULL DEFAULT 80,
  "peso_bronze" INTEGER NOT NULL DEFAULT 50,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "efficiency_config_version_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "efficiency_config_version_data_inicio_vigencia_idx"
  ON "efficiency_config_version"("data_inicio_vigencia");

INSERT INTO "efficiency_config_version" (
  "data_inicio_vigencia",
  "data_fim_vigencia",
  "peso_ouro",
  "peso_prata",
  "peso_bronze",
  "created_at",
  "updated_at"
)
SELECT
  TIMESTAMP '2026-01-01 00:00:00',
  NULL,
  COALESCE((SELECT "peso_ouro" FROM "efficiency_config" WHERE "id" = 1), 130),
  COALESCE((SELECT "peso_prata" FROM "efficiency_config" WHERE "id" = 1), 80),
  COALESCE((SELECT "peso_bronze" FROM "efficiency_config" WHERE "id" = 1), 50),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "efficiency_config_version");
