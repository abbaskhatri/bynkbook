CREATE TABLE IF NOT EXISTS entry_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL,
  account_id UUID NOT NULL,
  entry_id UUID NOT NULL,

  issue_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  severity TEXT NOT NULL DEFAULT 'WARNING',

  group_key TEXT NULL,
  details TEXT NOT NULL,

  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS u_entry_issues_scope
  ON entry_issues (business_id, account_id, entry_id, issue_type);

CREATE INDEX IF NOT EXISTS i_entry_issues_scope_status
  ON entry_issues (business_id, account_id, status);

CREATE INDEX IF NOT EXISTS i_entry_issues_scope_type
  ON entry_issues (business_id, account_id, issue_type);
