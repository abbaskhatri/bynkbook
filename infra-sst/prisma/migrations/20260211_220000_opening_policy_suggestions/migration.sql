ALTER TABLE "bank_connection"
ADD COLUMN IF NOT EXISTS "opening_policy" text NOT NULL DEFAULT 'AUTO';

ALTER TABLE "bank_connection"
ADD COLUMN IF NOT EXISTS "suggested_opening_cents" bigint,
ADD COLUMN IF NOT EXISTS "suggested_opening_date" date,
ADD COLUMN IF NOT EXISTS "suggested_balance_cents" bigint,
ADD COLUMN IF NOT EXISTS "suggested_balance_at" timestamptz;
