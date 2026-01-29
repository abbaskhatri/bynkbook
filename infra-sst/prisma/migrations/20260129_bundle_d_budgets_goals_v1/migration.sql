-- Budgets
CREATE TABLE IF NOT EXISTS "budget" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "business_id" uuid NOT NULL,
  "month" text NOT NULL, -- YYYY-MM
  "category_id" uuid NOT NULL,
  "budget_cents" bigint NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "u_budget_scope_month_category"
  ON "budget" ("business_id", "month", "category_id");

CREATE INDEX IF NOT EXISTS "i_budget_scope_month"
  ON "budget" ("business_id", "month");

CREATE INDEX IF NOT EXISTS "i_budget_scope_category"
  ON "budget" ("business_id", "category_id");

ALTER TABLE "budget"
  ADD CONSTRAINT "fk_budget_business"
  FOREIGN KEY ("business_id") REFERENCES "business"("id")
  ON DELETE CASCADE;

ALTER TABLE "budget"
  ADD CONSTRAINT "fk_budget_category"
  FOREIGN KEY ("category_id") REFERENCES "category"("id")
  ON DELETE CASCADE;

-- Goals
CREATE TABLE IF NOT EXISTS "goal" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "business_id" uuid NOT NULL,
  "name" text NOT NULL,
  "category_id" uuid NOT NULL,
  "month_start" text NOT NULL, -- YYYY-MM
  "month_end" text NULL,       -- YYYY-MM
  "target_cents" bigint NOT NULL,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "created_by_user_id" text NOT NULL
);

CREATE INDEX IF NOT EXISTS "i_goal_scope_status"
  ON "goal" ("business_id", "status");

CREATE INDEX IF NOT EXISTS "i_goal_scope_category"
  ON "goal" ("business_id", "category_id");

ALTER TABLE "goal"
  ADD CONSTRAINT "fk_goal_business"
  FOREIGN KEY ("business_id") REFERENCES "business"("id")
  ON DELETE CASCADE;

ALTER TABLE "goal"
  ADD CONSTRAINT "fk_goal_category"
  FOREIGN KEY ("category_id") REFERENCES "category"("id")
  ON DELETE CASCADE;
