-- CreateEnum
CREATE TYPE "ContactPersonType" AS ENUM ('INDIVIDUAL', 'COMPANY');

-- CreateEnum
CREATE TYPE "StatementStatus" AS ENUM ('PROCESSING', 'RECONCILED', 'PARTIAL', 'UNRECONCILED');

-- CreateEnum
CREATE TYPE "StatementLineStatus" AS ENUM ('UNMATCHED', 'MATCHED', 'IGNORED', 'CREATED');

-- CreateEnum
CREATE TYPE "StatementLineType" AS ENUM ('CREDIT', 'DEBIT');

-- AlterTable
ALTER TABLE "accounts_payable" ADD COLUMN     "contact_id" TEXT;

-- AlterTable
ALTER TABLE "accounts_receivable" ADD COLUMN     "contact_id" TEXT;

-- AlterTable
ALTER TABLE "bank_accounts" ADD COLUMN     "bank_id" TEXT;

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "person_type" "ContactPersonType" NOT NULL,
    "name" TEXT NOT NULL,
    "trade_name" TEXT,
    "document" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "number" TEXT,
    "complement" TEXT,
    "neighborhood" TEXT,
    "city" TEXT,
    "state" VARCHAR(2),
    "zip_code" TEXT,
    "is_customer" BOOLEAN NOT NULL DEFAULT false,
    "is_supplier" BOOLEAN NOT NULL DEFAULT false,
    "is_employee" BOOLEAN NOT NULL DEFAULT false,
    "is_partner" BOOLEAN NOT NULL DEFAULT false,
    "employee_role" TEXT,
    "employee_salary" BIGINT,
    "employee_admission_date" TIMESTAMP(3),
    "employee_dismissal_date" TIMESTAMP(3),
    "partner_share_percentage" DECIMAL(5,2),
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "metadeleted" BOOLEAN NOT NULL DEFAULT false,
    "company_id" TEXT NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "banks" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ispb" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "metadeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "banks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_statements" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "file_format" TEXT NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "initial_balance" BIGINT,
    "final_balance" BIGINT,
    "status" "StatementStatus" NOT NULL DEFAULT 'PROCESSING',
    "total_lines" INTEGER NOT NULL DEFAULT 0,
    "matched_lines" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "metadeleted" BOOLEAN NOT NULL DEFAULT false,
    "company_id" TEXT NOT NULL,
    "bank_account_id" TEXT NOT NULL,

    CONSTRAINT "bank_statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_statement_lines" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "type" "StatementLineType" NOT NULL,
    "fit_id" TEXT,
    "reference" TEXT,
    "status" "StatementLineStatus" NOT NULL DEFAULT 'UNMATCHED',
    "match_score" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "statement_id" TEXT NOT NULL,
    "transaction_id" TEXT,

    CONSTRAINT "bank_statement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contacts_metadeleted_idx" ON "contacts"("metadeleted");

-- CreateIndex
CREATE INDEX "contacts_company_id_idx" ON "contacts"("company_id");

-- CreateIndex
CREATE INDEX "contacts_is_customer_idx" ON "contacts"("is_customer");

-- CreateIndex
CREATE INDEX "contacts_is_supplier_idx" ON "contacts"("is_supplier");

-- CreateIndex
CREATE INDEX "contacts_is_employee_idx" ON "contacts"("is_employee");

-- CreateIndex
CREATE UNIQUE INDEX "banks_code_key" ON "banks"("code");

-- CreateIndex
CREATE INDEX "banks_metadeleted_idx" ON "banks"("metadeleted");

-- CreateIndex
CREATE INDEX "bank_statements_metadeleted_idx" ON "bank_statements"("metadeleted");

-- CreateIndex
CREATE INDEX "bank_statements_company_id_idx" ON "bank_statements"("company_id");

-- CreateIndex
CREATE INDEX "bank_statements_bank_account_id_idx" ON "bank_statements"("bank_account_id");

-- CreateIndex
CREATE INDEX "bank_statement_lines_statement_id_idx" ON "bank_statement_lines"("statement_id");

-- CreateIndex
CREATE INDEX "bank_statement_lines_status_idx" ON "bank_statement_lines"("status");

-- CreateIndex
CREATE INDEX "bank_statement_lines_fit_id_idx" ON "bank_statement_lines"("fit_id");

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_bank_id_fkey" FOREIGN KEY ("bank_id") REFERENCES "banks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts_payable" ADD CONSTRAINT "accounts_payable_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts_receivable" ADD CONSTRAINT "accounts_receivable_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_statement_id_fkey" FOREIGN KEY ("statement_id") REFERENCES "bank_statements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
