-- Entry merge audit (CPA-safe)
CREATE TABLE IF NOT EXISTS "entry_merge" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "business_id" uuid NOT NULL,
  "account_id" uuid NOT NULL,
  "survivor_entry_id" uuid NOT NULL,
  "merged_entry_id" uuid NOT NULL,
  "reason" text,
  "actor_user_id" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "entry_merge_business_account_idx"
  ON "entry_merge" ("business_id", "account_id");

CREATE INDEX IF NOT EXISTS "entry_merge_survivor_idx"
  ON "entry_merge" ("survivor_entry_id");

CREATE INDEX IF NOT EXISTS "entry_merge_merged_idx"
  ON "entry_merge" ("merged_entry_id");