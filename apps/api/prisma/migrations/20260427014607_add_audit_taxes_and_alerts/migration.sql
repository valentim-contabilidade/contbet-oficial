-- CreateEnum
CREATE TYPE "AuditCheckType" AS ENUM ('MOVEMENTS', 'FEES', 'TAXES');

-- CreateTable
CREATE TABLE "audit_taxes_checks" (
    "id" TEXT NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "calculated_total" BIGINT NOT NULL DEFAULT 0,
    "paid_total" BIGINT NOT NULL DEFAULT 0,
    "diff_total" BIGINT NOT NULL DEFAULT 0,
    "per_tax_breakdown" JSONB,
    "alert_level" "AuditAlertLevel" NOT NULL DEFAULT 'OK',
    "notes" TEXT,
    "company_id" TEXT NOT NULL,
    "triggered_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "audit_taxes_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_alerts" (
    "id" TEXT NOT NULL,
    "check_type" "AuditCheckType" NOT NULL,
    "reference_id" TEXT NOT NULL,
    "previous_level" "AuditAlertLevel",
    "current_level" "AuditAlertLevel" NOT NULL,
    "message" TEXT,
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "acknowledged_at" TIMESTAMP(3),
    "acknowledged_by_user_id" TEXT,
    "company_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "audit_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_taxes_checks_metadeleted_idx" ON "audit_taxes_checks"("metadeleted");

-- CreateIndex
CREATE INDEX "audit_taxes_checks_company_id_idx" ON "audit_taxes_checks"("company_id");

-- CreateIndex
CREATE INDEX "audit_taxes_checks_from_date_to_date_idx" ON "audit_taxes_checks"("from_date", "to_date");

-- CreateIndex
CREATE INDEX "audit_alerts_metadeleted_idx" ON "audit_alerts"("metadeleted");

-- CreateIndex
CREATE INDEX "audit_alerts_company_id_acknowledged_idx" ON "audit_alerts"("company_id", "acknowledged");

-- CreateIndex
CREATE INDEX "audit_alerts_check_type_idx" ON "audit_alerts"("check_type");

-- AddForeignKey
ALTER TABLE "audit_taxes_checks" ADD CONSTRAINT "audit_taxes_checks_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_alerts" ADD CONSTRAINT "audit_alerts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
