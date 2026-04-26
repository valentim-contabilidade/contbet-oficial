-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "tax_regime" "TaxRegime" NOT NULL DEFAULT 'LUCRO_REAL';

-- AlterTable
ALTER TABLE "company_tax_configs" ADD COLUMN     "presumed_csll_rate" DECIMAL(5,2) NOT NULL DEFAULT 32.0,
ADD COLUMN     "presumed_irpj_rate" DECIMAL(5,2) NOT NULL DEFAULT 32.0;
