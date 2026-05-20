-- CreateEnum
CREATE TYPE "AuditAlertLevel" AS ENUM ('OK', 'WARNING', 'CRITICAL');

-- AlterTable
ALTER TABLE "bank_accounts" ADD COLUMN     "is_player_wallet" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "audit_movements_checks" (
    "id" TEXT NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "sistema_deposits" BIGINT NOT NULL DEFAULT 0,
    "sistema_withdrawals" BIGINT NOT NULL DEFAULT 0,
    "sistema_net" BIGINT NOT NULL DEFAULT 0,
    "banco_deposits" BIGINT NOT NULL DEFAULT 0,
    "banco_withdrawals" BIGINT NOT NULL DEFAULT 0,
    "banco_net" BIGINT NOT NULL DEFAULT 0,
    "diff_deposits" BIGINT NOT NULL DEFAULT 0,
    "diff_withdrawals" BIGINT NOT NULL DEFAULT 0,
    "diff_net" BIGINT NOT NULL DEFAULT 0,
    "alert_level" "AuditAlertLevel" NOT NULL DEFAULT 'OK',
    "notes" TEXT,
    "daily_breakdown" JSONB,
    "company_id" TEXT NOT NULL,
    "triggered_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "audit_movements_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_movements_checks_metadeleted_idx" ON "audit_movements_checks"("metadeleted");

-- CreateIndex
CREATE INDEX "audit_movements_checks_company_id_idx" ON "audit_movements_checks"("company_id");

-- CreateIndex
CREATE INDEX "audit_movements_checks_from_date_to_date_idx" ON "audit_movements_checks"("from_date", "to_date");

-- AddForeignKey
ALTER TABLE "audit_movements_checks" ADD CONSTRAINT "audit_movements_checks_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
