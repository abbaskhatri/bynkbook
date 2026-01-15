-- Phase 6B: Monthly Reconciliation Snapshots (account-scoped)

CREATE TABLE IF NOT EXISTS reconcile_snapshot (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL,
  account_id UUID NOT NULL,
  month TEXT NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id UUID NOT NULL,

  bank_unmatched_count INT NOT NULL DEFAULT 0,
  bank_partial_count INT NOT NULL DEFAULT 0,
  bank_matched_count INT NOT NULL DEFAULT 0,
  entries_expected_count INT NOT NULL DEFAULT 0,
  entries_matched_count INT NOT NULL DEFAULT 0,
  revert_count INT NOT NULL DEFAULT 0,

  remaining_abs_cents BIGINT NOT NULL DEFAULT 0,

  bank_csv_s3_key TEXT NOT NULL,
  matches_csv_s3_key TEXT NOT NULL,
  audit_csv_s3_key TEXT NOT NULL,

  bank_csv_sha256 TEXT NULL,
  matches_csv_sha256 TEXT NULL,
  audit_csv_sha256 TEXT NULL,

  CONSTRAINT u_reconcile_snapshot_scope_month UNIQUE (business_id, account_id, month)
);

CREATE INDEX IF NOT EXISTS i_reconcile_snapshot_scope_created
  ON reconcile_snapshot (business_id, account_id, created_at DESC);
