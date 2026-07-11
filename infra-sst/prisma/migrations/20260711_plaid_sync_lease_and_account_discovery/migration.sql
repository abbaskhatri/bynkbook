ALTER TABLE "bank_connection"
  ADD COLUMN IF NOT EXISTS "new_accounts_available" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "sync_lock_token" TEXT,
  ADD COLUMN IF NOT EXISTS "sync_lock_expires_at" TIMESTAMPTZ(6);

CREATE INDEX IF NOT EXISTS "i_bank_connection_sync_lease"
  ON "bank_connection" ("sync_lock_expires_at")
  WHERE "sync_lock_token" IS NOT NULL;
