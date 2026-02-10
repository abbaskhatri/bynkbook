DO $$
BEGIN
  IF to_regclass('user_business_role') IS NOT NULL THEN
    ALTER TABLE user_business_role
      ADD COLUMN IF NOT EXISTS email text;
  ELSE
    RAISE EXCEPTION 'user_business_role table not found';
  END IF;
END $$;
