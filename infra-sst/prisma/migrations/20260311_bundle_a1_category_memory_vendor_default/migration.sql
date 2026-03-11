-- Bundle A1
-- Add vendor default category support
ALTER TABLE "vendor"
ADD COLUMN "default_category_id" UUID NULL;

CREATE INDEX "i_vendor_scope_default_category"
ON "vendor" ("business_id", "default_category_id");

ALTER TABLE "vendor"
ADD CONSTRAINT "vendor_default_category_id_fkey"
FOREIGN KEY ("default_category_id")
REFERENCES "category"("id")
ON DELETE SET NULL
ON UPDATE NO ACTION;

-- Bundle A1
-- Add CategoryMemory table
CREATE TABLE "category_memory" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "merchant_normalized" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "category_id" UUID NOT NULL,
  "accept_count" INTEGER NOT NULL DEFAULT 0,
  "override_count" INTEGER NOT NULL DEFAULT 0,
  "last_used_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "confidence_score" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),

  CONSTRAINT "category_memory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "category_memory_business_id_fkey"
    FOREIGN KEY ("business_id")
    REFERENCES "business"("id")
    ON DELETE CASCADE
    ON UPDATE NO ACTION,
  CONSTRAINT "category_memory_category_id_fkey"
    FOREIGN KEY ("category_id")
    REFERENCES "category"("id")
    ON DELETE CASCADE
    ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX "u_category_memory_scope_merchant_direction_category"
ON "category_memory" ("business_id", "merchant_normalized", "direction", "category_id");

CREATE INDEX "i_category_memory_scope_merchant_direction"
ON "category_memory" ("business_id", "merchant_normalized", "direction");

CREATE INDEX "i_category_memory_scope_category"
ON "category_memory" ("business_id", "category_id");