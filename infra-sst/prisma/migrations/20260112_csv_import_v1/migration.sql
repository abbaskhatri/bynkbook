ALTER TABLE bank_transaction
  ADD COLUMN IF NOT EXISTS source TEXT NULL,
  ADD COLUMN IF NOT EXISTS source_upload_id UUID NULL,
  ADD COLUMN IF NOT EXISTS source_parser TEXT NULL,
  ADD COLUMN IF NOT EXISTS import_hash TEXT NULL;

ALTER TABLE bank_transaction
  ALTER COLUMN plaid_transaction_id DROP NOT NULL,
  ALTER COLUMN plaid_account_id DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS u_bank_txn_csv_dedupe
  ON bank_transaction (business_id, account_id, source, import_hash);
