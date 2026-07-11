ALTER TABLE "business"
  ALTER COLUMN "authz_mode" SET DEFAULT 'ENFORCE',
  ALTER COLUMN "authz_enforce_wave" SET DEFAULT 4;

-- Complete the staged rollout for existing businesses. OFF was the historical
-- default, not a founder-selected per-business setting. SOFT is retained as an
-- intentional observation mode, while legacy ENFORCE_ONLY becomes full ENFORCE.
UPDATE "business"
SET
  "authz_mode" = 'ENFORCE',
  "authz_enforce_wave" = GREATEST("authz_enforce_wave", 4)
WHERE "authz_mode" IN ('OFF', 'ENFORCE_ONLY');
