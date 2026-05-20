-- CreateEnum
CREATE TYPE "GgrMethodology" AS ENUM ('OFFICIAL', 'DEDUCT_CASHBACK', 'DEDUCT_BONUS_CASHBACK');

-- AlterTable
ALTER TABLE "company_tax_configs" ADD COLUMN     "ggr_methodology" "GgrMethodology" NOT NULL DEFAULT 'OFFICIAL',
ADD COLUMN     "ggr_term_pdf_data" BYTEA,
ADD COLUMN     "ggr_term_pdf_url" TEXT,
ADD COLUMN     "ggr_term_signed_at" TIMESTAMP(3),
ADD COLUMN     "ggr_term_signed_by_cpf" TEXT,
ADD COLUMN     "ggr_term_signed_by_name" TEXT,
ADD COLUMN     "ggr_term_uploaded_by_id" TEXT;

-- AlterTable
ALTER TABLE "ggr_monthly_apurations" ADD COLUMN     "ggr_methodology" "GgrMethodology" NOT NULL DEFAULT 'OFFICIAL',
ADD COLUMN     "ggr_term_snapshot_signed" TIMESTAMP(3),
ADD COLUMN     "ggr_term_snapshot_url" TEXT,
ADD COLUMN     "total_bonus" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "total_cashback" BIGINT NOT NULL DEFAULT 0;
