ALTER TABLE "account"
ADD COLUMN IF NOT EXISTS "currency_code" varchar(3),
ADD COLUMN IF NOT EXISTS "institution_name" text,
ADD COLUMN IF NOT EXISTS "last4" varchar(8);
