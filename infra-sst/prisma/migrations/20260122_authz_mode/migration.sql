-- Phase 7.1: per-business authz mode flag (OFF|SOFT|ENFORCE|ENFORCE_ONLY)

ALTER TABLE business
  ADD COLUMN IF NOT EXISTS authz_mode TEXT NOT NULL DEFAULT 'OFF';
