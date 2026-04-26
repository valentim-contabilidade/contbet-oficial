-- CreateEnum
CREATE TYPE "PayableSource" AS ENUM ('MANUAL', 'FISCAL_IMPORT', 'RECURRING', 'PAYROLL', 'TAX_APURATION');

-- AlterTable
ALTER TABLE "accounts_payable" ADD COLUMN     "duplicate_of_id" TEXT,
ADD COLUMN     "source" "PayableSource" NOT NULL DEFAULT 'MANUAL';

-- CreateIndex
CREATE INDEX "accounts_payable_source_idx" ON "accounts_payable"("source");

-- CreateIndex
CREATE INDEX "accounts_payable_duplicate_of_id_idx" ON "accounts_payable"("duplicate_of_id");

-- AddForeignKey
ALTER TABLE "accounts_payable" ADD CONSTRAINT "accounts_payable_duplicate_of_id_fkey" FOREIGN KEY ("duplicate_of_id") REFERENCES "accounts_payable"("id") ON DELETE SET NULL ON UPDATE CASCADE;
