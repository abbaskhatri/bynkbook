-- CreateTable
CREATE TABLE "vendor" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "notes" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "vendor_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "vendor"
ADD CONSTRAINT "vendor_business_id_fkey"
FOREIGN KEY ("business_id") REFERENCES "business"("id")
ON DELETE CASCADE ON UPDATE NO ACTION;

-- CreateIndex
CREATE UNIQUE INDEX "u_vendor_scope_name" ON "vendor"("business_id","name");

-- CreateIndex
CREATE INDEX "i_vendor_scope_updated_desc" ON "vendor"("business_id","updated_at" DESC);
