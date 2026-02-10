DO $$
BEGIN
  -- Some environments may have "Business" (capitalized), others may have business (lowercase).
  IF to_regclass('"Business"') IS NOT NULL THEN
    ALTER TABLE "Business"
      ADD COLUMN IF NOT EXISTS "logo_upload_id" uuid;
  ELSIF to_regclass('business') IS NOT NULL THEN
    ALTER TABLE business
      ADD COLUMN IF NOT EXISTS logo_upload_id uuid;
  ELSE
    RAISE EXCEPTION 'Business table not found (checked "Business" and business)';
  END IF;
END $$;
