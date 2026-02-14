-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('INSCRITO', 'PRE_INSCRITO', 'OUTRO');

-- AlterTable
ALTER TABLE "athlete_categories"
ADD COLUMN "registration_status" "RegistrationStatus";

