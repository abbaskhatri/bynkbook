-- Match Groups (CPA-clean; full match only; positive cents)

CREATE TABLE "match_group" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "business_id" uuid NOT NULL,
  "account_id" uuid NOT NULL,
  "direction" text NOT NULL,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "created_by_user_id" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "voided_at" timestamptz NULL,
  "voided_by_user_id" text NULL,
  "void_reason" text NULL
);

CREATE INDEX "i_match_group_scope_status_created"
  ON "match_group" ("business_id","account_id","status","created_at");

CREATE INDEX "i_match_group_scope_dir_status"
  ON "match_group" ("business_id","account_id","direction","status");

ALTER TABLE "match_group"
  ADD CONSTRAINT "fk_match_group_business"
  FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE;

ALTER TABLE "match_group"
  ADD CONSTRAINT "fk_match_group_account"
  FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE;

CREATE TABLE "match_group_bank" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "match_group_id" uuid NOT NULL,
  "business_id" uuid NOT NULL,
  "account_id" uuid NOT NULL,
  "bank_transaction_id" uuid NOT NULL,
  "matched_amount_cents" bigint NOT NULL
);

CREATE INDEX "i_mg_bank_by_txn"
  ON "match_group_bank" ("business_id","account_id","bank_transaction_id");

CREATE INDEX "i_mg_bank_by_group"
  ON "match_group_bank" ("match_group_id");

ALTER TABLE "match_group_bank"
  ADD CONSTRAINT "fk_mg_bank_group"
  FOREIGN KEY ("match_group_id") REFERENCES "match_group"("id") ON DELETE CASCADE;

ALTER TABLE "match_group_bank"
  ADD CONSTRAINT "fk_mg_bank_business"
  FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE;

ALTER TABLE "match_group_bank"
  ADD CONSTRAINT "fk_mg_bank_account"
  FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE;

ALTER TABLE "match_group_bank"
  ADD CONSTRAINT "fk_mg_bank_bank_txn"
  FOREIGN KEY ("bank_transaction_id") REFERENCES "bank_transaction"("id") ON DELETE CASCADE;

CREATE TABLE "match_group_entry" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "match_group_id" uuid NOT NULL,
  "business_id" uuid NOT NULL,
  "account_id" uuid NOT NULL,
  "entry_id" uuid NOT NULL,
  "matched_amount_cents" bigint NOT NULL
);

CREATE INDEX "i_mg_entry_by_entry"
  ON "match_group_entry" ("business_id","account_id","entry_id");

CREATE INDEX "i_mg_entry_by_group"
  ON "match_group_entry" ("match_group_id");

ALTER TABLE "match_group_entry"
  ADD CONSTRAINT "fk_mg_entry_group"
  FOREIGN KEY ("match_group_id") REFERENCES "match_group"("id") ON DELETE CASCADE;

ALTER TABLE "match_group_entry"
  ADD CONSTRAINT "fk_mg_entry_business"
  FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE;

ALTER TABLE "match_group_entry"
  ADD CONSTRAINT "fk_mg_entry_account"
  FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE;

ALTER TABLE "match_group_entry"
  ADD CONSTRAINT "fk_mg_entry_entry"
  FOREIGN KEY ("entry_id") REFERENCES "entry"("id") ON DELETE CASCADE;
