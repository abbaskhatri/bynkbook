-- Add idempotency key for bank-txn create-entry (soft-delete friendly)
ALTER TABLE "entry"
ADD COLUMN IF NOT EXISTS "source_bank_transaction_id" uuid;

-- Helpful lookup index
CREATE INDEX IF NOT EXISTS "idx_entry_scope_source_bank_txn"
ON "entry" ("business_id", "account_id", "source_bank_transaction_id");

-- Partial unique index: only blocks duplicates among active (non-deleted) entries
CREATE UNIQUE INDEX IF NOT EXISTS "u_entry_scope_source_bank_txn_active"
ON "entry" ("business_id", "account_id", "source_bank_transaction_id")
WHERE "deleted_at" IS NULL AND "source_bank_transaction_id" IS NOT NULL;