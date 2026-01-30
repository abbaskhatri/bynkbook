-- CreateTable
CREATE TABLE "transfer" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "from_account_id" UUID NOT NULL,
  "to_account_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "transfer_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "transfer"
ADD CONSTRAINT "transfer_business_id_fkey"
FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AlterTable
ALTER TABLE "entry" ADD COLUMN "transfer_id" UUID;

-- AddForeignKey
ALTER TABLE "entry"
ADD CONSTRAINT "entry_transfer_id_fkey"
FOREIGN KEY ("transfer_id") REFERENCES "transfer"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- CreateIndex
CREATE INDEX "idx_entry_business_transfer" ON "entry"("business_id", "transfer_id");

-- CreateIndex
CREATE INDEX "i_transfer_business_from" ON "transfer"("business_id", "from_account_id");

-- CreateIndex
CREATE INDEX "i_transfer_business_to" ON "transfer"("business_id", "to_account_id");
