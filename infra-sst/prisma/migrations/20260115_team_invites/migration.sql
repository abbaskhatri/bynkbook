-- Phase: Team & Roles management (Business invites)
-- Ensure user_business_role id has a default (needed for invite accept create)
ALTER TABLE user_business_role
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
  
CREATE TABLE IF NOT EXISTS business_invite (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES business(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id UUID NOT NULL,

  expires_at TIMESTAMPTZ NOT NULL,

  accepted_at TIMESTAMPTZ NULL,
  accepted_by_user_id UUID NULL,

  revoked_at TIMESTAMPTZ NULL,
  revoked_by_user_id UUID NULL
);

CREATE INDEX IF NOT EXISTS i_business_invite_scope_created
  ON business_invite (business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS i_business_invite_scope_email
  ON business_invite (business_id, email);
