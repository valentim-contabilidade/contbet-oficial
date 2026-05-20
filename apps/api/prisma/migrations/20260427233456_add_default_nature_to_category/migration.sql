-- AlterTable
ALTER TABLE "financial_categories" ADD COLUMN     "default_nature_id" TEXT;

-- CreateIndex
CREATE INDEX "financial_categories_default_nature_id_idx" ON "financial_categories"("default_nature_id");

-- AddForeignKey
ALTER TABLE "financial_categories" ADD CONSTRAINT "financial_categories_default_nature_id_fkey" FOREIGN KEY ("default_nature_id") REFERENCES "financial_natures"("id") ON DELETE SET NULL ON UPDATE CASCADE;
