CREATE TABLE IF NOT EXISTS bank_connection (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL,
  account_id UUID NOT NULL,
  plaid_item_id TEXT NOT NULL,
  plaid_account_id TEXT NOT NULL,
  access_token_ciphertext TEXT NOT NULL,
  effective_start_date DATE NOT NULL,
  sync_cursor TEXT NULL,
  last_sync_at TIMESTAMPTZ NULL,
  has_new_transactions BOOLEAN NOT NULL DEFAULT FALSE,
  last_known_balance_cents BIGINT NULL,
  last_known_balance_at TIMESTAMPTZ NULL,
  opening_adjustment_created_at TIMESTAMPTZ NULL,
  institution_name TEXT NULL,
  institution_id TEXT NULL,
  status TEXT NOT NULL DEFAULT 'CONNECTED',
  error_code TEXT NULL,
  error_message TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS u_bank_connection_scope_account
  ON bank_connection (business_id, account_id);

CREATE UNIQUE INDEX IF NOT EXISTS u_bank_connection_scope_plaid_account
  ON bank_connection (business_id, plaid_account_id);

CREATE INDEX IF NOT EXISTS i_bank_connection_scope_status
  ON bank_connection (business_id, status);

CREATE TABLE IF NOT EXISTS bank_transaction (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL,
  account_id UUID NOT NULL,
  plaid_transaction_id TEXT NOT NULL,
  plaid_account_id TEXT NOT NULL,
  posted_date DATE NOT NULL,
  authorized_date DATE NULL,
  amount_cents BIGINT NOT NULL,
  name TEXT NOT NULL,
  is_pending BOOLEAN NOT NULL DEFAULT FALSE,
  iso_currency_code TEXT NULL,
  is_removed BOOLEAN NOT NULL DEFAULT FALSE,
  removed_at TIMESTAMPTZ NULL,
  raw JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS u_bank_txn_scope_plaid_txn
  ON bank_transaction (business_id, plaid_transaction_id);

CREATE INDEX IF NOT EXISTS i_bank_txn_scope_account_posted_created
  ON bank_transaction (business_id, account_id, posted_date DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS i_bank_txn_scope_flags
  ON bank_transaction (business_id, account_id, is_removed, is_pending);
