-- AlterTable
ALTER TABLE "fiscal_providers" ADD COLUMN     "issue_cnae" TEXT,
ADD COLUMN     "issue_codigo_servico" TEXT,
ADD COLUMN     "issue_descricao_template" TEXT,
ADD COLUMN     "issue_inscricao_municipal" TEXT,
ADD COLUMN     "issue_iss_aliquota" DECIMAL(5,2),
ADD COLUMN     "issue_tomador_cnpj" TEXT,
ADD COLUMN     "issue_tomador_razao_social" TEXT;
