ALTER TABLE "bank_transaction"
  ADD COLUMN "source_removed_at" TIMESTAMPTZ(6),
  ADD COLUMN "source_removal_code" TEXT;

CREATE INDEX "i_bank_txn_source_removed"
  ON "bank_transaction" ("business_id", "account_id", "source_removed_at");
