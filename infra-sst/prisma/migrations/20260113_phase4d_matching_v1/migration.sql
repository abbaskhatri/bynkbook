-- Phase 4D v1: BankMatch + Entry adjustment fields

CREATE TABLE IF NOT EXISTS bank_match (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL,
  account_id UUID NOT NULL,

  bank_transaction_id UUID NOT NULL,
  entry_id UUID NOT NULL,

  match_type TEXT NOT NULL,
  matched_amount_cents BIGINT NOT NULL,

  created_by_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  voided_at TIMESTAMPTZ NULL,
  voided_by_user_id UUID NULL
);

CREATE INDEX IF NOT EXISTS i_bank_match_bank_txn
  ON bank_match (business_id, account_id, bank_transaction_id);

CREATE INDEX IF NOT EXISTS i_bank_match_entry
  ON bank_match (business_id, account_id, entry_id);

CREATE INDEX IF NOT EXISTS i_bank_match_voided
  ON bank_match (business_id, account_id, voided_at);

-- Entry adjustment fields
ALTER TABLE entry
  ADD COLUMN IF NOT EXISTS is_adjustment BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS adjusted_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS adjusted_by_user_id UUID NULL,
  ADD COLUMN IF NOT EXISTS adjustment_reason TEXT NULL;
