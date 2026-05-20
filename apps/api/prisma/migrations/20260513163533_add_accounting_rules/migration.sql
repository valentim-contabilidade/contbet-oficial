-- CreateTable
CREATE TABLE "accounting_rules" (
    "id" TEXT NOT NULL,
    "event_key" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "debit_code" TEXT,
    "credit_code" TEXT,
    "historic_code" INTEGER,
    "historic_template" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "metadeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "accounting_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounting_rules_event_key_key" ON "accounting_rules"("event_key");

-- CreateIndex
CREATE INDEX "accounting_rules_group_idx" ON "accounting_rules"("group");
