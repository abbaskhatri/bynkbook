-- Preserve the verified Plaid account identity traits used to prevent a
-- reconnect from silently redirecting a local ledger to a different account.
ALTER TABLE "bank_connection"
  ADD COLUMN "plaid_type" TEXT,
  ADD COLUMN "plaid_subtype" TEXT,
  ADD COLUMN "plaid_currency_code" VARCHAR(3);
