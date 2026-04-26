-- DropForeignKey
ALTER TABLE "fiscal_certificates" DROP CONSTRAINT "fiscal_certificates_provider_id_fkey";

-- AlterTable
ALTER TABLE "fiscal_certificates" ALTER COLUMN "provider_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "fiscal_certificates" ADD CONSTRAINT "fiscal_certificates_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "fiscal_providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
