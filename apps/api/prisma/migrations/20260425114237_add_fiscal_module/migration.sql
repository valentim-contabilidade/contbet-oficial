-- CreateEnum
CREATE TYPE "FiscalDocumentType" AS ENUM ('NFSE', 'NFE', 'NFCE', 'CTE');

-- CreateEnum
CREATE TYPE "FiscalDocumentDirection" AS ENUM ('INCOMING', 'OUTGOING');

-- CreateEnum
CREATE TYPE "FiscalDocumentStatus" AS ENUM ('PENDING', 'AUTHORIZED', 'CANCELLED', 'REJECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "FiscalProviderType" AS ENUM ('PLUGNOTAS', 'FOCUS_NFE', 'NFE_IO', 'ARQUIVEI');

-- CreateEnum
CREATE TYPE "FiscalCertificateStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED', 'ERROR');

-- CreateTable
CREATE TABLE "fiscal_providers" (
    "id" TEXT NOT NULL,
    "type" "FiscalProviderType" NOT NULL DEFAULT 'PLUGNOTAS',
    "api_key" TEXT NOT NULL,
    "api_secret" TEXT,
    "base_url" TEXT,
    "sandbox_mode" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_sync_at" TIMESTAMP(3),
    "last_error" TEXT,
    "auto_sync_enabled" BOOLEAN NOT NULL DEFAULT true,
    "auto_sync_period" INTEGER NOT NULL DEFAULT 24,
    "notes" TEXT,
    "company_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "metadeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "fiscal_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_certificates" (
    "id" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "holder_name" TEXT NOT NULL,
    "serial_number" TEXT,
    "issuer" TEXT,
    "valid_from" TIMESTAMP(3) NOT NULL,
    "valid_to" TIMESTAMP(3) NOT NULL,
    "encrypted_pfx_base64" TEXT NOT NULL,
    "encrypted_password" TEXT NOT NULL,
    "status" "FiscalCertificateStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_error" TEXT,
    "provider_certificate_id" TEXT,
    "uploaded_to_provider_at" TIMESTAMP(3),
    "notes" TEXT,
    "company_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "metadeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "fiscal_certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_documents" (
    "id" TEXT NOT NULL,
    "document_type" "FiscalDocumentType" NOT NULL,
    "direction" "FiscalDocumentDirection" NOT NULL,
    "status" "FiscalDocumentStatus" NOT NULL,
    "access_key" TEXT,
    "document_number" TEXT,
    "series" TEXT,
    "rps_number" TEXT,
    "rps_series" TEXT,
    "issue_date" TIMESTAMP(3) NOT NULL,
    "authorization_date" TIMESTAMP(3),
    "cancellation_date" TIMESTAMP(3),
    "issuer_cnpj" TEXT NOT NULL,
    "issuer_name" TEXT NOT NULL,
    "issuer_municipality_code" TEXT,
    "issuer_state" VARCHAR(2),
    "recipient_cnpj" TEXT,
    "recipient_name" TEXT,
    "recipient_municipality_code" TEXT,
    "total_amount" BIGINT NOT NULL DEFAULT 0,
    "service_amount" BIGINT NOT NULL DEFAULT 0,
    "products_amount" BIGINT NOT NULL DEFAULT 0,
    "iss_amount" BIGINT NOT NULL DEFAULT 0,
    "iss_rate" DECIMAL(5,2),
    "irrf_amount" BIGINT NOT NULL DEFAULT 0,
    "inss_amount" BIGINT NOT NULL DEFAULT 0,
    "pis_amount" BIGINT NOT NULL DEFAULT 0,
    "cofins_amount" BIGINT NOT NULL DEFAULT 0,
    "csll_amount" BIGINT NOT NULL DEFAULT 0,
    "icms_amount" BIGINT NOT NULL DEFAULT 0,
    "ipi_amount" BIGINT NOT NULL DEFAULT 0,
    "description" TEXT,
    "service_code" TEXT,
    "cnae" TEXT,
    "cfop" TEXT,
    "cst" TEXT,
    "xml_content" TEXT,
    "pdf_url" TEXT,
    "provider_document_id" TEXT,
    "raw_response" JSONB,
    "matched_payable_id" TEXT,
    "matched_receivable_id" TEXT,
    "matched_at" TIMESTAMP(3),
    "matched_by_user_id" TEXT,
    "match_score" INTEGER,
    "notes" TEXT,
    "company_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "metadeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "fiscal_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_sync_logs" (
    "id" TEXT NOT NULL,
    "sync_type" TEXT NOT NULL,
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "documents_fetched" INTEGER NOT NULL DEFAULT 0,
    "documents_created" INTEGER NOT NULL DEFAULT 0,
    "documents_updated" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "duration_ms" INTEGER,
    "company_id" TEXT NOT NULL,
    "triggered_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fiscal_sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_providers_company_id_key" ON "fiscal_providers"("company_id");

-- CreateIndex
CREATE INDEX "fiscal_providers_metadeleted_idx" ON "fiscal_providers"("metadeleted");

-- CreateIndex
CREATE INDEX "fiscal_providers_company_id_idx" ON "fiscal_providers"("company_id");

-- CreateIndex
CREATE INDEX "fiscal_certificates_metadeleted_idx" ON "fiscal_certificates"("metadeleted");

-- CreateIndex
CREATE INDEX "fiscal_certificates_company_id_idx" ON "fiscal_certificates"("company_id");

-- CreateIndex
CREATE INDEX "fiscal_certificates_cnpj_idx" ON "fiscal_certificates"("cnpj");

-- CreateIndex
CREATE INDEX "fiscal_certificates_status_idx" ON "fiscal_certificates"("status");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_documents_access_key_key" ON "fiscal_documents"("access_key");

-- CreateIndex
CREATE INDEX "fiscal_documents_metadeleted_idx" ON "fiscal_documents"("metadeleted");

-- CreateIndex
CREATE INDEX "fiscal_documents_company_id_idx" ON "fiscal_documents"("company_id");

-- CreateIndex
CREATE INDEX "fiscal_documents_document_type_idx" ON "fiscal_documents"("document_type");

-- CreateIndex
CREATE INDEX "fiscal_documents_direction_idx" ON "fiscal_documents"("direction");

-- CreateIndex
CREATE INDEX "fiscal_documents_status_idx" ON "fiscal_documents"("status");

-- CreateIndex
CREATE INDEX "fiscal_documents_issue_date_idx" ON "fiscal_documents"("issue_date");

-- CreateIndex
CREATE INDEX "fiscal_documents_issuer_cnpj_idx" ON "fiscal_documents"("issuer_cnpj");

-- CreateIndex
CREATE INDEX "fiscal_documents_recipient_cnpj_idx" ON "fiscal_documents"("recipient_cnpj");

-- CreateIndex
CREATE INDEX "fiscal_documents_matched_payable_id_idx" ON "fiscal_documents"("matched_payable_id");

-- CreateIndex
CREATE INDEX "fiscal_documents_matched_receivable_id_idx" ON "fiscal_documents"("matched_receivable_id");

-- CreateIndex
CREATE INDEX "fiscal_sync_logs_company_id_idx" ON "fiscal_sync_logs"("company_id");

-- CreateIndex
CREATE INDEX "fiscal_sync_logs_created_at_idx" ON "fiscal_sync_logs"("created_at");

-- AddForeignKey
ALTER TABLE "fiscal_providers" ADD CONSTRAINT "fiscal_providers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_certificates" ADD CONSTRAINT "fiscal_certificates_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_certificates" ADD CONSTRAINT "fiscal_certificates_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "fiscal_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_documents" ADD CONSTRAINT "fiscal_documents_matched_payable_id_fkey" FOREIGN KEY ("matched_payable_id") REFERENCES "accounts_payable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_documents" ADD CONSTRAINT "fiscal_documents_matched_receivable_id_fkey" FOREIGN KEY ("matched_receivable_id") REFERENCES "accounts_receivable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_documents" ADD CONSTRAINT "fiscal_documents_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_documents" ADD CONSTRAINT "fiscal_documents_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "fiscal_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_sync_logs" ADD CONSTRAINT "fiscal_sync_logs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
