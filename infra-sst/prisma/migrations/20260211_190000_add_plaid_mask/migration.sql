ALTER TABLE "bank_connection"
ADD COLUMN IF NOT EXISTS "plaid_mask" varchar(8);
