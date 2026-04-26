-- CreateEnum
CREATE TYPE "RevenueType" AS ENUM ('OPERATIONAL', 'NON_OPERATIONAL');

-- AlterTable
ALTER TABLE "accounts_receivable" ADD COLUMN     "revenue_type" "RevenueType" NOT NULL DEFAULT 'NON_OPERATIONAL';

-- CreateIndex
CREATE INDEX "accounts_receivable_revenue_type_idx" ON "accounts_receivable"("revenue_type");
