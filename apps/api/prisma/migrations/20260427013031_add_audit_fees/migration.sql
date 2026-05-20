-- AlterTable
ALTER TABLE "bank_accounts" ADD COLUMN     "fee_per_credit" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "fee_per_debit" BIGINT NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "audit_fees_checks" (
    "id" TEXT NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "total_deposits_count" INTEGER NOT NULL DEFAULT 0,
    "total_withdrawals_count" INTEGER NOT NULL DEFAULT 0,
    "expected_credit_fees" BIGINT NOT NULL DEFAULT 0,
    "expected_debit_fees" BIGINT NOT NULL DEFAULT 0,
    "expected_total_fees" BIGINT NOT NULL DEFAULT 0,
    "actual_total_fees" BIGINT NOT NULL DEFAULT 0,
    "diff_total_fees" BIGINT NOT NULL DEFAULT 0,
    "alert_level" "AuditAlertLevel" NOT NULL DEFAULT 'OK',
    "notes" TEXT,
    "per_account_breakdown" JSONB,
    "company_id" TEXT NOT NULL,
    "triggered_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "audit_fees_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_fees_checks_metadeleted_idx" ON "audit_fees_checks"("metadeleted");

-- CreateIndex
CREATE INDEX "audit_fees_checks_company_id_idx" ON "audit_fees_checks"("company_id");

-- CreateIndex
CREATE INDEX "audit_fees_checks_from_date_to_date_idx" ON "audit_fees_checks"("from_date", "to_date");

-- AddForeignKey
ALTER TABLE "audit_fees_checks" ADD CONSTRAINT "audit_fees_checks_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
