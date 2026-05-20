-- CreateTable
CREATE TABLE "serpro_sessions" (
    "id" TEXT NOT NULL,
    "contratante_cnpj" TEXT NOT NULL,
    "encrypted_jwt_token" TEXT NOT NULL,
    "encrypted_access_token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "serpro_sessions_pkey" PRIMARY KEY ("id")
);
