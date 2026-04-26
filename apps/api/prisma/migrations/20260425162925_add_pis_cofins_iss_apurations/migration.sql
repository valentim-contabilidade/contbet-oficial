-- CreateEnum
CREATE TYPE "TaxApurationStatus" AS ENUM ('OPEN', 'CLOSED', 'PAID');

-- CreateEnum
CREATE TYPE "IssCalculationBase" AS ENUM ('GGR', 'NGR');

-- AlterTable
ALTER TABLE "accounts_payable" ADD COLUMN     "iss_apuration_id" TEXT,
ADD COLUMN     "pis_cofins_apuration_id" TEXT;

-- AlterTable
ALTER TABLE "company_tax_configs" ADD COLUMN     "iss_calculation_base" "IssCalculationBase" NOT NULL DEFAULT 'GGR',
ADD COLUMN     "iss_rate" DECIMAL(5,2) NOT NULL DEFAULT 5.0;

-- CreateTable
CREATE TABLE "pis_cofins_apurations" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "pis_cofins_regime" "PisCofinsRegime" NOT NULL DEFAULT 'NAO_CUMULATIVO',
    "ggr_revenue" BIGINT NOT NULL DEFAULT 0,
    "other_revenue" BIGINT NOT NULL DEFAULT 0,
    "total_revenue" BIGINT NOT NULL DEFAULT 0,
    "expenses_with_credit" BIGINT NOT NULL DEFAULT 0,
    "pis_rate" DECIMAL(5,2) NOT NULL DEFAULT 1.65,
    "pis_amount" BIGINT NOT NULL DEFAULT 0,
    "pis_credits" BIGINT NOT NULL DEFAULT 0,
    "pis_amount_payable" BIGINT NOT NULL DEFAULT 0,
    "cofins_rate" DECIMAL(5,2) NOT NULL DEFAULT 7.6,
    "cofins_amount" BIGINT NOT NULL DEFAULT 0,
    "cofins_credits" BIGINT NOT NULL DEFAULT 0,
    "cofins_amount_payable" BIGINT NOT NULL DEFAULT 0,
    "total_taxes" BIGINT NOT NULL DEFAULT 0,
    "status" "TaxApurationStatus" NOT NULL DEFAULT 'OPEN',
    "closed_at" TIMESTAMP(3),
    "closed_by_id" TEXT,
    "paid_at" TIMESTAMP(3),
    "notes" TEXT,
    "company_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "metadeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "pis_cofins_apurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "iss_apurations" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "calculation_base" "IssCalculationBase" NOT NULL DEFAULT 'GGR',
    "ggr_amount" BIGINT NOT NULL DEFAULT 0,
    "bet_tax_amount" BIGINT NOT NULL DEFAULT 0,
    "base_amount" BIGINT NOT NULL DEFAULT 0,
    "iss_rate" DECIMAL(5,2) NOT NULL DEFAULT 5.0,
    "iss_amount" BIGINT NOT NULL DEFAULT 0,
    "total_taxes" BIGINT NOT NULL DEFAULT 0,
    "status" "TaxApurationStatus" NOT NULL DEFAULT 'OPEN',
    "closed_at" TIMESTAMP(3),
    "closed_by_id" TEXT,
    "paid_at" TIMESTAMP(3),
    "notes" TEXT,
    "company_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "metadeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "iss_apurations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pis_cofins_apurations_metadeleted_idx" ON "pis_cofins_apurations"("metadeleted");

-- CreateIndex
CREATE INDEX "pis_cofins_apurations_company_id_idx" ON "pis_cofins_apurations"("company_id");

-- CreateIndex
CREATE INDEX "pis_cofins_apurations_year_month_idx" ON "pis_cofins_apurations"("year", "month");

-- CreateIndex
CREATE INDEX "pis_cofins_apurations_status_idx" ON "pis_cofins_apurations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "pis_cofins_apurations_company_id_year_month_key" ON "pis_cofins_apurations"("company_id", "year", "month");

-- CreateIndex
CREATE INDEX "iss_apurations_metadeleted_idx" ON "iss_apurations"("metadeleted");

-- CreateIndex
CREATE INDEX "iss_apurations_company_id_idx" ON "iss_apurations"("company_id");

-- CreateIndex
CREATE INDEX "iss_apurations_year_month_idx" ON "iss_apurations"("year", "month");

-- CreateIndex
CREATE INDEX "iss_apurations_status_idx" ON "iss_apurations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "iss_apurations_company_id_year_month_key" ON "iss_apurations"("company_id", "year", "month");

-- AddForeignKey
ALTER TABLE "accounts_payable" ADD CONSTRAINT "accounts_payable_pis_cofins_apuration_id_fkey" FOREIGN KEY ("pis_cofins_apuration_id") REFERENCES "pis_cofins_apurations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts_payable" ADD CONSTRAINT "accounts_payable_iss_apuration_id_fkey" FOREIGN KEY ("iss_apuration_id") REFERENCES "iss_apurations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pis_cofins_apurations" ADD CONSTRAINT "pis_cofins_apurations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "iss_apurations" ADD CONSTRAINT "iss_apurations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
