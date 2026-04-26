-- CreateEnum
CREATE TYPE "GgrSourceType" AS ENUM ('CSV_UPLOAD', 'XLSX_UPLOAD', 'API_REST', 'MANUAL');

-- CreateEnum
CREATE TYPE "GgrApurationStatus" AS ENUM ('OPEN', 'CLOSED', 'PAID');

-- CreateEnum
CREATE TYPE "DataSourceStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ERROR');

-- AlterTable
ALTER TABLE "accounts_payable" ADD COLUMN     "ggr_apuration_id" TEXT;

-- CreateTable
CREATE TABLE "ggr_daily_records" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "total_bets" BIGINT NOT NULL DEFAULT 0,
    "total_prizes" BIGINT NOT NULL DEFAULT 0,
    "total_deposits" BIGINT NOT NULL DEFAULT 0,
    "total_withdrawals" BIGINT NOT NULL DEFAULT 0,
    "bet_count" INTEGER NOT NULL DEFAULT 0,
    "prize_count" INTEGER NOT NULL DEFAULT 0,
    "deposit_count" INTEGER NOT NULL DEFAULT 0,
    "withdrawal_count" INTEGER NOT NULL DEFAULT 0,
    "active_players" INTEGER NOT NULL DEFAULT 0,
    "ggr" BIGINT NOT NULL DEFAULT 0,
    "source_type" "GgrSourceType" NOT NULL,
    "source_reference" TEXT,
    "source_id" TEXT,
    "notes" TEXT,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "imported_by_id" TEXT,
    "brand_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "data_source_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "metadeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ggr_daily_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ggr_monthly_apurations" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "total_bets" BIGINT NOT NULL DEFAULT 0,
    "total_prizes" BIGINT NOT NULL DEFAULT 0,
    "total_deposits" BIGINT NOT NULL DEFAULT 0,
    "total_withdrawals" BIGINT NOT NULL DEFAULT 0,
    "ggr" BIGINT NOT NULL DEFAULT 0,
    "net_revenue" BIGINT NOT NULL DEFAULT 0,
    "tax_lei14790_rate" DECIMAL(5,2) NOT NULL DEFAULT 12.0,
    "tax_lei14790_amount" BIGINT NOT NULL DEFAULT 0,
    "irrf_threshold_cents" BIGINT NOT NULL DEFAULT 282400,
    "irrf_rate" DECIMAL(5,2) NOT NULL DEFAULT 15.0,
    "irrf_taxable_base" BIGINT NOT NULL DEFAULT 0,
    "irrf_amount" BIGINT NOT NULL DEFAULT 0,
    "pis_rate" DECIMAL(5,2) NOT NULL DEFAULT 0.65,
    "pis_amount" BIGINT NOT NULL DEFAULT 0,
    "cofins_rate" DECIMAL(5,2) NOT NULL DEFAULT 3.0,
    "cofins_amount" BIGINT NOT NULL DEFAULT 0,
    "total_taxes" BIGINT NOT NULL DEFAULT 0,
    "status" "GgrApurationStatus" NOT NULL DEFAULT 'OPEN',
    "closed_at" TIMESTAMP(3),
    "closed_by_id" TEXT,
    "paid_at" TIMESTAMP(3),
    "notes" TEXT,
    "brand_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "metadeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ggr_monthly_apurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_sources" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "GgrSourceType" NOT NULL,
    "status" "DataSourceStatus" NOT NULL DEFAULT 'ACTIVE',
    "base_url" TEXT,
    "auth_type" TEXT,
    "auth_token" TEXT,
    "field_mapping" JSONB,
    "config" JSONB,
    "last_sync_at" TIMESTAMP(3),
    "last_error" TEXT,
    "brand_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "metadeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "data_sources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ggr_daily_records_metadeleted_idx" ON "ggr_daily_records"("metadeleted");

-- CreateIndex
CREATE INDEX "ggr_daily_records_company_id_idx" ON "ggr_daily_records"("company_id");

-- CreateIndex
CREATE INDEX "ggr_daily_records_brand_id_date_idx" ON "ggr_daily_records"("brand_id", "date");

-- CreateIndex
CREATE INDEX "ggr_daily_records_date_idx" ON "ggr_daily_records"("date");

-- CreateIndex
CREATE UNIQUE INDEX "ggr_daily_records_brand_id_date_key" ON "ggr_daily_records"("brand_id", "date");

-- CreateIndex
CREATE INDEX "ggr_monthly_apurations_metadeleted_idx" ON "ggr_monthly_apurations"("metadeleted");

-- CreateIndex
CREATE INDEX "ggr_monthly_apurations_company_id_idx" ON "ggr_monthly_apurations"("company_id");

-- CreateIndex
CREATE INDEX "ggr_monthly_apurations_brand_id_year_month_idx" ON "ggr_monthly_apurations"("brand_id", "year", "month");

-- CreateIndex
CREATE INDEX "ggr_monthly_apurations_status_idx" ON "ggr_monthly_apurations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ggr_monthly_apurations_brand_id_year_month_key" ON "ggr_monthly_apurations"("brand_id", "year", "month");

-- CreateIndex
CREATE INDEX "data_sources_metadeleted_idx" ON "data_sources"("metadeleted");

-- CreateIndex
CREATE INDEX "data_sources_brand_id_idx" ON "data_sources"("brand_id");

-- CreateIndex
CREATE INDEX "data_sources_status_idx" ON "data_sources"("status");

-- AddForeignKey
ALTER TABLE "accounts_payable" ADD CONSTRAINT "accounts_payable_ggr_apuration_id_fkey" FOREIGN KEY ("ggr_apuration_id") REFERENCES "ggr_monthly_apurations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ggr_daily_records" ADD CONSTRAINT "ggr_daily_records_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ggr_daily_records" ADD CONSTRAINT "ggr_daily_records_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ggr_daily_records" ADD CONSTRAINT "ggr_daily_records_data_source_id_fkey" FOREIGN KEY ("data_source_id") REFERENCES "data_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ggr_monthly_apurations" ADD CONSTRAINT "ggr_monthly_apurations_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ggr_monthly_apurations" ADD CONSTRAINT "ggr_monthly_apurations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_sources" ADD CONSTRAINT "data_sources_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_sources" ADD CONSTRAINT "data_sources_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
