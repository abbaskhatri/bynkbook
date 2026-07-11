DROP INDEX IF EXISTS "u_bill_app_entry_bill_active";

CREATE INDEX IF NOT EXISTS "i_bill_app_entry_bill_active"
  ON "bill_payment_application" ("entry_id", "bill_id", "is_active");

CREATE UNIQUE INDEX "u_bill_app_entry_bill_active_only"
  ON "bill_payment_application" ("entry_id", "bill_id")
  WHERE "is_active" = TRUE;
