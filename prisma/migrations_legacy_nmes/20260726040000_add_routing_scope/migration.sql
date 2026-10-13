-- CreateEnum
CREATE TYPE "RoutingScope" AS ENUM ('COMMON', 'ITEM_SPECIFIC');

-- AlterTable
ALTER TABLE "Routing" ADD COLUMN     "scope" "RoutingScope" NOT NULL DEFAULT 'ITEM_SPECIFIC';

