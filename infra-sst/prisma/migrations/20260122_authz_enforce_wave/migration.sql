-- Phase 7.2: per-business enforcement wave gate

ALTER TABLE business
  ADD COLUMN IF NOT EXISTS authz_enforce_wave INT NOT NULL DEFAULT 0;
