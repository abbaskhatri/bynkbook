-- Phase: Roles & Permissions (store-only)

CREATE TABLE IF NOT EXISTS business_role_policy (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES business(id) ON DELETE CASCADE,

  role TEXT NOT NULL,
  policy_json JSONB NOT NULL,

  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_user_id UUID NOT NULL,

  CONSTRAINT u_business_role_policy_scope_role UNIQUE (business_id, role)
);

CREATE INDEX IF NOT EXISTS i_business_role_policy_scope_updated
  ON business_role_policy (business_id, updated_at DESC);
