-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "brand_id" TEXT,
ADD COLUMN     "employee_base_salary" BIGINT,
ADD COLUMN     "employee_variable_salary" BIGINT;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;
