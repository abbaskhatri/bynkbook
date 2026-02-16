-- CreateTable
CREATE TABLE "bill" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "vendor_id" UUID NOT NULL,
  "invoice_date" DATE NOT NULL,
  "due_date" DATE NOT NULL,
  "amount_cents" BIGINT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "memo" TEXT,
  "terms" TEXT,
  "upload_id" UUID,
  "created_by_user_id" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "voided_at" TIMESTAMPTZ(6),
  "voided_by_user_id" TEXT,
  "void_reason" TEXT,
  CONSTRAINT "bill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_payment_application" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "account_id" UUID NOT NULL,
  "entry_id" UUID NOT NULL,
  "bill_id" UUID NOT NULL,
  "applied_amount_cents" BIGINT NOT NULL,
  "applied_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "created_by_user_id" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "voided_at" TIMESTAMPTZ(6),
  "voided_by_user_id" TEXT,
  "void_reason" TEXT,
  CONSTRAINT "bill_payment_application_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "bill"
ADD CONSTRAINT "bill_business_id_fkey"
FOREIGN KEY ("business_id") REFERENCES "business"("id")
ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bill"
ADD CONSTRAINT "bill_vendor_id_fkey"
FOREIGN KEY ("vendor_id") REFERENCES "vendor"("id")
ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bill"
ADD CONSTRAINT "bill_upload_id_fkey"
FOREIGN KEY ("upload_id") REFERENCES "upload"("id")
ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bill_payment_application"
ADD CONSTRAINT "bill_payment_application_business_id_fkey"
FOREIGN KEY ("business_id") REFERENCES "business"("id")
ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bill_payment_application"
ADD CONSTRAINT "bill_payment_application_account_id_fkey"
FOREIGN KEY ("account_id") REFERENCES "account"("id")
ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bill_payment_application"
ADD CONSTRAINT "bill_payment_application_entry_id_fkey"
FOREIGN KEY ("entry_id") REFERENCES "entry"("id")
ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bill_payment_application"
ADD CONSTRAINT "bill_payment_application_bill_id_fkey"
FOREIGN KEY ("bill_id") REFERENCES "bill"("id")
ON DELETE CASCADE ON UPDATE NO ACTION;

-- CreateIndex
CREATE INDEX "i_bill_scope_vendor_due" ON "bill"("business_id","vendor_id","due_date");

-- CreateIndex
CREATE INDEX "i_bill_scope_status_due" ON "bill"("business_id","status","due_date");

-- CreateIndex
CREATE UNIQUE INDEX "u_bill_app_entry_bill_active" ON "bill_payment_application"("entry_id","bill_id","is_active");

-- CreateIndex
CREATE INDEX "i_bill_app_scope_bill_active" ON "bill_payment_application"("business_id","bill_id","is_active");

-- CreateIndex
CREATE INDEX "i_bill_app_scope_entry_active" ON "bill_payment_application"("business_id","entry_id","is_active");

-- CreateIndex
CREATE INDEX "i_bill_app_scope_account_entry" ON "bill_payment_application"("business_id","account_id","entry_id");
