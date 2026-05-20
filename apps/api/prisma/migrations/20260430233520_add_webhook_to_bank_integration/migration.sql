-- AlterTable
ALTER TABLE "bank_integrations" ADD COLUMN     "last_webhook_at" TIMESTAMP(3),
ADD COLUMN     "webhook_token" TEXT;
