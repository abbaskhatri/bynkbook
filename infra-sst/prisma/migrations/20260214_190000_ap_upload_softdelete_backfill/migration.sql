-- Upload soft-delete columns
ALTER TABLE "upload"
  ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "deleted_by_user_id" TEXT;

-- Hide-by-default queries will filter deleted_at IS NULL in code.

-- Bill uniqueness by upload_id (idempotent backfill)
-- Unique indexes allow multiple NULLs.
CREATE UNIQUE INDEX IF NOT EXISTS "u_bill_upload_id" ON "bill"("upload_id");
