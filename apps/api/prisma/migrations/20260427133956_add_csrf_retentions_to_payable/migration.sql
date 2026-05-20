-- AlterTable
ALTER TABLE "accounts_payable" ADD COLUMN     "cofins_retained" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "csll_retained" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "irrf_retained" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "is_service_from_pj" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pis_retained" BIGINT NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "accounts_payable_is_service_from_pj_idx" ON "accounts_payable"("is_service_from_pj");
