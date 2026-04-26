-- CreateEnum
CREATE TYPE "TaxRegime" AS ENUM ('LUCRO_REAL', 'LUCRO_PRESUMIDO', 'SIMPLES_NACIONAL');

-- CreateEnum
CREATE TYPE "PisCofinsRegime" AS ENUM ('CUMULATIVO', 'NAO_CUMULATIVO');

-- CreateEnum
CREATE TYPE "IrpjApurationPeriod" AS ENUM ('TRIMESTRAL', 'ANUAL_ESTIMATIVA');

-- CreateEnum
CREATE TYPE "IrpjApurationStatus" AS ENUM ('OPEN', 'CLOSED', 'PAID');

-- CreateEnum
CREATE TYPE "LalurAdjustmentType" AS ENUM ('ADDITION', 'EXCLUSION');

-- AlterTable
ALTER TABLE "accounts_payable" ADD COLUMN     "cofins_credit_amount" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "generates_pis_cofins_credit" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "irpj_apuration_id" TEXT,
ADD COLUMN     "is_deductible_expense" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "pis_credit_amount" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ggr_monthly_apurations" ADD COLUMN     "cofins_amount_payable" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "cofins_credits" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "pis_amount_payable" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "pis_cofins_regime" "PisCofinsRegime" NOT NULL DEFAULT 'CUMULATIVO',
ADD COLUMN     "pis_credits" BIGINT NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "company_tax_configs" (
    "id" TEXT NOT NULL,
    "tax_regime" "TaxRegime" NOT NULL DEFAULT 'LUCRO_REAL',
    "pis_cofins_regime" "PisCofinsRegime" NOT NULL DEFAULT 'NAO_CUMULATIVO',
    "apuration_period" "IrpjApurationPeriod" NOT NULL DEFAULT 'TRIMESTRAL',
    "pis_rate" DECIMAL(5,2) NOT NULL DEFAULT 1.65,
    "cofins_rate" DECIMAL(5,2) NOT NULL DEFAULT 7.6,
    "irpj_rate" DECIMAL(5,2) NOT NULL DEFAULT 15.0,
    "irpj_additional_rate" DECIMAL(5,2) NOT NULL DEFAULT 10.0,
    "irpj_additional_threshold_cents" BIGINT NOT NULL DEFAULT 6000000,
    "csll_rate" DECIMAL(5,2) NOT NULL DEFAULT 9.0,
    "notes" TEXT,
    "company_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_tax_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "irpj_csll_apurations" (
    "id" TEXT NOT NULL,
    "period_type" "IrpjApurationPeriod" NOT NULL,
    "year" INTEGER NOT NULL,
    "quarter" INTEGER,
    "month" INTEGER,
    "ggr_revenue" BIGINT NOT NULL DEFAULT 0,
    "other_revenue" BIGINT NOT NULL DEFAULT 0,
    "total_revenue" BIGINT NOT NULL DEFAULT 0,
    "deductible_expenses" BIGINT NOT NULL DEFAULT 0,
    "accounting_profit" BIGINT NOT NULL DEFAULT 0,
    "total_additions" BIGINT NOT NULL DEFAULT 0,
    "total_exclusions" BIGINT NOT NULL DEFAULT 0,
    "taxable_profit" BIGINT NOT NULL DEFAULT 0,
    "irpj_base_amount" BIGINT NOT NULL DEFAULT 0,
    "irpj_additional_amount" BIGINT NOT NULL DEFAULT 0,
    "irpj_total" BIGINT NOT NULL DEFAULT 0,
    "irpj_rate" DECIMAL(5,2) NOT NULL DEFAULT 15.0,
    "irpj_additional_rate" DECIMAL(5,2) NOT NULL DEFAULT 10.0,
    "irpj_additional_threshold" BIGINT NOT NULL DEFAULT 6000000,
    "csll_amount" BIGINT NOT NULL DEFAULT 0,
    "csll_rate" DECIMAL(5,2) NOT NULL DEFAULT 9.0,
    "total_taxes" BIGINT NOT NULL DEFAULT 0,
    "status" "IrpjApurationStatus" NOT NULL DEFAULT 'OPEN',
    "closed_at" TIMESTAMP(3),
    "closed_by_id" TEXT,
    "paid_at" TIMESTAMP(3),
    "notes" TEXT,
    "company_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "metadeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "irpj_csll_apurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lalur_adjustments" (
    "id" TEXT NOT NULL,
    "type" "LalurAdjustmentType" NOT NULL,
    "description" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "notes" TEXT,
    "reference_date" TIMESTAMP(3),
    "company_id" TEXT NOT NULL,
    "apuration_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "metadeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "lalur_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_tax_configs_company_id_key" ON "company_tax_configs"("company_id");

-- CreateIndex
CREATE INDEX "irpj_csll_apurations_metadeleted_idx" ON "irpj_csll_apurations"("metadeleted");

-- CreateIndex
CREATE INDEX "irpj_csll_apurations_company_id_idx" ON "irpj_csll_apurations"("company_id");

-- CreateIndex
CREATE INDEX "irpj_csll_apurations_year_quarter_idx" ON "irpj_csll_apurations"("year", "quarter");

-- CreateIndex
CREATE INDEX "irpj_csll_apurations_status_idx" ON "irpj_csll_apurations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "irpj_csll_apurations_company_id_period_type_year_quarter_mo_key" ON "irpj_csll_apurations"("company_id", "period_type", "year", "quarter", "month");

-- CreateIndex
CREATE INDEX "lalur_adjustments_metadeleted_idx" ON "lalur_adjustments"("metadeleted");

-- CreateIndex
CREATE INDEX "lalur_adjustments_company_id_idx" ON "lalur_adjustments"("company_id");

-- CreateIndex
CREATE INDEX "lalur_adjustments_apuration_id_idx" ON "lalur_adjustments"("apuration_id");

-- CreateIndex
CREATE INDEX "accounts_payable_is_deductible_expense_idx" ON "accounts_payable"("is_deductible_expense");

-- CreateIndex
CREATE INDEX "accounts_payable_generates_pis_cofins_credit_idx" ON "accounts_payable"("generates_pis_cofins_credit");

-- AddForeignKey
ALTER TABLE "accounts_payable" ADD CONSTRAINT "accounts_payable_irpj_apuration_id_fkey" FOREIGN KEY ("irpj_apuration_id") REFERENCES "irpj_csll_apurations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_tax_configs" ADD CONSTRAINT "company_tax_configs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "irpj_csll_apurations" ADD CONSTRAINT "irpj_csll_apurations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lalur_adjustments" ADD CONSTRAINT "lalur_adjustments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lalur_adjustments" ADD CONSTRAINT "lalur_adjustments_apuration_id_fkey" FOREIGN KEY ("apuration_id") REFERENCES "irpj_csll_apurations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
