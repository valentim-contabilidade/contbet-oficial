-- AlterTable
ALTER TABLE "fiscal_documents" ADD COLUMN     "confirmed_at" TIMESTAMP(3),
ADD COLUMN     "confirmed_by_user_id" TEXT;

-- CreateIndex
CREATE INDEX "fiscal_documents_confirmed_at_idx" ON "fiscal_documents"("confirmed_at");
