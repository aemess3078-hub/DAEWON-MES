-- CreateEnum
CREATE TYPE "InspectionStage" AS ENUM ('FIRST', 'MID', 'FINAL');

-- AlterTable
ALTER TABLE "QualityInspection" ADD COLUMN     "stage" "InspectionStage" NOT NULL DEFAULT 'MID';
