-- CreateTable
CREATE TABLE "brand_users" (
    "user_id" TEXT NOT NULL,
    "brand_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brand_users_pkey" PRIMARY KEY ("user_id","brand_id")
);

-- CreateTable
CREATE TABLE "fiscal_claim_attempts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "brand_id" TEXT NOT NULL,
    "document_number" TEXT NOT NULL,
    "issuer_cnpj" TEXT NOT NULL,
    "total_amount_cents" BIGINT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "failure_reason" TEXT,
    "attempted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fiscal_claim_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "brand_users_user_id_idx" ON "brand_users"("user_id");

-- CreateIndex
CREATE INDEX "brand_users_brand_id_idx" ON "brand_users"("brand_id");

-- CreateIndex
CREATE INDEX "fiscal_claim_attempts_user_id_attempted_at_idx" ON "fiscal_claim_attempts"("user_id", "attempted_at");

-- CreateIndex
CREATE INDEX "fiscal_claim_attempts_attempted_at_idx" ON "fiscal_claim_attempts"("attempted_at");

-- AddForeignKey
ALTER TABLE "brand_users" ADD CONSTRAINT "brand_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_users" ADD CONSTRAINT "brand_users_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_claim_attempts" ADD CONSTRAINT "fiscal_claim_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
