ALTER TABLE "vendor" ADD COLUMN "address" TEXT;

CREATE TABLE "check_print_setting" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "account_id" UUID NOT NULL,
  "template_code" TEXT NOT NULL DEFAULT 'SSLT104',
  "next_check_number" VARCHAR(32) NOT NULL,
  "offset_x_mils" INTEGER NOT NULL DEFAULT 0,
  "offset_y_mils" INTEGER NOT NULL DEFAULT 0,
  "created_by_user_id" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "check_print_setting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "check_payment" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "account_id" UUID NOT NULL,
  "entry_id" UUID,
  "vendor_id" UUID,
  "category_id" UUID,
  "check_number" VARCHAR(32) NOT NULL,
  "issued_date" DATE NOT NULL,
  "payee_name" TEXT NOT NULL,
  "payee_address" TEXT,
  "amount_cents" BIGINT NOT NULL,
  "memo" TEXT,
  "purpose" TEXT NOT NULL DEFAULT 'GENERAL',
  "bill_allocations" JSONB,
  "template_code" TEXT NOT NULL DEFAULT 'SSLT104',
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "print_count" INTEGER NOT NULL DEFAULT 0,
  "last_printed_at" TIMESTAMPTZ(6),
  "confirmed_at" TIMESTAMPTZ(6),
  "voided_at" TIMESTAMPTZ(6),
  "voided_by_user_id" TEXT,
  "void_reason" TEXT,
  "created_by_user_id" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "check_payment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "check_payment_amount_positive" CHECK ("amount_cents" > 0),
  CONSTRAINT "check_payment_template_sslt104" CHECK ("template_code" = 'SSLT104'),
  CONSTRAINT "check_payment_status_valid" CHECK ("status" IN ('DRAFT', 'PRINTED', 'VOIDED'))
);

CREATE UNIQUE INDEX "u_check_print_setting_scope_account" ON "check_print_setting"("business_id", "account_id");
CREATE INDEX "i_check_print_setting_scope_updated" ON "check_print_setting"("business_id", "updated_at" DESC);
CREATE UNIQUE INDEX "u_check_payment_entry" ON "check_payment"("entry_id");
CREATE UNIQUE INDEX "u_check_payment_scope_number" ON "check_payment"("business_id", "account_id", "check_number");
CREATE INDEX "i_check_payment_scope_status_date" ON "check_payment"("business_id", "status", "issued_date" DESC);
CREATE INDEX "i_check_payment_scope_account_date" ON "check_payment"("business_id", "account_id", "issued_date" DESC);
CREATE INDEX "i_check_payment_scope_vendor_date" ON "check_payment"("business_id", "vendor_id", "issued_date" DESC);

ALTER TABLE "check_print_setting" ADD CONSTRAINT "check_print_setting_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "check_print_setting" ADD CONSTRAINT "check_print_setting_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "check_payment" ADD CONSTRAINT "check_payment_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "check_payment" ADD CONSTRAINT "check_payment_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "check_payment" ADD CONSTRAINT "check_payment_entry_id_fkey"
  FOREIGN KEY ("entry_id") REFERENCES "entry"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "check_payment" ADD CONSTRAINT "check_payment_vendor_id_fkey"
  FOREIGN KEY ("vendor_id") REFERENCES "vendor"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "check_payment" ADD CONSTRAINT "check_payment_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
