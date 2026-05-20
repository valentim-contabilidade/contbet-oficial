-- AlterTable
ALTER TABLE "fiscal_documents" ADD COLUMN     "brand_id" TEXT;

-- CreateIndex
CREATE INDEX "fiscal_documents_brand_id_idx" ON "fiscal_documents"("brand_id");

-- AddForeignKey
ALTER TABLE "fiscal_documents" ADD CONSTRAINT "fiscal_documents_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;
