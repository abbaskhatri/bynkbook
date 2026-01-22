-- Phase 6D: Activity / Audit Log (business-scoped)

CREATE TABLE IF NOT EXISTS activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES business(id) ON DELETE CASCADE,
  scope_account_id UUID NULL,

  event_type TEXT NOT NULL,
  actor_user_id UUID NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload_json JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS i_activity_log_scope_created
  ON activity_log (business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS i_activity_log_scope_account_created
  ON activity_log (business_id, scope_account_id, created_at DESC);
