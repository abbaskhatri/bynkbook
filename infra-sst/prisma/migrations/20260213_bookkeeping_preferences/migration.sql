-- CreateTable
CREATE TABLE "bookkeeping_preferences" (
  "business_id" uuid NOT NULL,
  "amount_tolerance_cents" bigint NOT NULL DEFAULT 0,
  "days_tolerance" integer NOT NULL DEFAULT 3,
  "duplicate_window_days" integer NOT NULL DEFAULT 7,
  "stale_threshold_days" integer NOT NULL DEFAULT 90,
  "auto_suggest" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "bookkeeping_preferences_pkey" PRIMARY KEY ("business_id")
);

-- AddForeignKey
ALTER TABLE "bookkeeping_preferences"
ADD CONSTRAINT "bookkeeping_preferences_business_id_fkey"
FOREIGN KEY ("business_id") REFERENCES "business"("id")
ON DELETE CASCADE ON UPDATE NO ACTION;
