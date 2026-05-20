-- CreateTable
CREATE TABLE "serpro_sitfis_protocols" (
    "id" TEXT NOT NULL,
    "contribuinte_cnpj" TEXT NOT NULL,
    "protocolo_relatorio" TEXT NOT NULL,
    "tempo_espera" INTEGER NOT NULL DEFAULT 0,
    "cached_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "serpro_sitfis_protocols_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "serpro_sitfis_protocols_contribuinte_cnpj_key" ON "serpro_sitfis_protocols"("contribuinte_cnpj");
