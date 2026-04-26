-- CreateEnum
CREATE TYPE "BankIntegrationProvider" AS ENUM ('PLUGGY', 'BELVO', 'KLAVI');

-- CreateEnum
CREATE TYPE "BankConnectionStatus" AS ENUM ('ACTIVE', 'WAITING_USER_INPUT', 'UPDATING', 'LOGIN_ERROR', 'OUTDATED', 'DISCONNECTED', 'ERROR');

-- AlterTable
ALTER TABLE "bank_accounts" ADD COLUMN     "bank_connection_id" TEXT,
ADD COLUMN     "provider_account_id" TEXT;

-- CreateTable
CREATE TABLE "bank_integrations" (
    "id" TEXT NOT NULL,
    "type" "BankIntegrationProvider" NOT NULL DEFAULT 'PLUGGY',
    "client_id" TEXT NOT NULL,
    "client_secret" TEXT NOT NULL,
    "sandbox_mode" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_error" TEXT,
    "notes" TEXT,
    "company_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "metadeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "bank_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_connections" (
    "id" TEXT NOT NULL,
    "provider_item_id" TEXT NOT NULL,
    "provider_connector_id" TEXT,
    "institution_name" TEXT,
    "institution_logo" TEXT,
    "status" "BankConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "status_detail" TEXT,
    "last_sync_at" TIMESTAMP(3),
    "next_auto_sync_at" TIMESTAMP(3),
    "last_error" TEXT,
    "raw_meta" JSONB,
    "company_id" TEXT NOT NULL,
    "integration_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "metadeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "bank_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bank_integrations_company_id_key" ON "bank_integrations"("company_id");

-- CreateIndex
CREATE INDEX "bank_integrations_metadeleted_idx" ON "bank_integrations"("metadeleted");

-- CreateIndex
CREATE INDEX "bank_integrations_company_id_idx" ON "bank_integrations"("company_id");

-- CreateIndex
CREATE INDEX "bank_connections_metadeleted_idx" ON "bank_connections"("metadeleted");

-- CreateIndex
CREATE INDEX "bank_connections_company_id_idx" ON "bank_connections"("company_id");

-- CreateIndex
CREATE INDEX "bank_connections_status_idx" ON "bank_connections"("status");

-- CreateIndex
CREATE UNIQUE INDEX "bank_connections_integration_id_provider_item_id_key" ON "bank_connections"("integration_id", "provider_item_id");

-- CreateIndex
CREATE INDEX "bank_accounts_bank_connection_id_idx" ON "bank_accounts"("bank_connection_id");

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_bank_connection_id_fkey" FOREIGN KEY ("bank_connection_id") REFERENCES "bank_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_integrations" ADD CONSTRAINT "bank_integrations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_connections" ADD CONSTRAINT "bank_connections_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_connections" ADD CONSTRAINT "bank_connections_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "bank_integrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
