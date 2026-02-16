ALTER TABLE "entry"
  ADD COLUMN IF NOT EXISTS "entry_kind" TEXT NOT NULL DEFAULT 'GENERAL';

CREATE INDEX IF NOT EXISTS "i_entry_scope_kind" ON "entry"("business_id","entry_kind");
