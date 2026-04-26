-- CreateEnum
CREATE TYPE "DreSection" AS ENUM ('RECEITA_OPERACIONAL', 'DEDUCAO_RECEITA', 'CUSTO_OPERACIONAL', 'DESPESA_OPERACIONAL', 'DESPESA_NAO_OPERACIONAL', 'RECEITA_FINANCEIRA', 'DESPESA_FINANCEIRA', 'IMPOSTO_LUCRO');

-- CreateEnum
CREATE TYPE "NatureType" AS ENUM ('RECEITA', 'DESPESA');

-- AlterTable
ALTER TABLE "accounts_payable" ADD COLUMN     "nature_id" TEXT;

-- AlterTable
ALTER TABLE "accounts_receivable" ADD COLUMN     "nature_id" TEXT;

-- CreateTable
CREATE TABLE "financial_natures" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "NatureType" NOT NULL,
    "dre_section" "DreSection" NOT NULL,
    "dre_order" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "accounting_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "metadeleted" BOOLEAN NOT NULL DEFAULT false,
    "company_id" TEXT NOT NULL,

    CONSTRAINT "financial_natures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "financial_natures_metadeleted_idx" ON "financial_natures"("metadeleted");

-- CreateIndex
CREATE INDEX "financial_natures_company_id_idx" ON "financial_natures"("company_id");

-- CreateIndex
CREATE INDEX "financial_natures_type_idx" ON "financial_natures"("type");

-- CreateIndex
CREATE INDEX "financial_natures_dre_section_idx" ON "financial_natures"("dre_section");

-- CreateIndex
CREATE INDEX "accounts_payable_nature_id_idx" ON "accounts_payable"("nature_id");

-- CreateIndex
CREATE INDEX "accounts_receivable_nature_id_idx" ON "accounts_receivable"("nature_id");

-- AddForeignKey
ALTER TABLE "financial_natures" ADD CONSTRAINT "financial_natures_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts_payable" ADD CONSTRAINT "accounts_payable_nature_id_fkey" FOREIGN KEY ("nature_id") REFERENCES "financial_natures"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts_receivable" ADD CONSTRAINT "accounts_receivable_nature_id_fkey" FOREIGN KEY ("nature_id") REFERENCES "financial_natures"("id") ON DELETE SET NULL ON UPDATE CASCADE;
