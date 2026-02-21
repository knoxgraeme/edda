-- Add cron schedule columns for system crons (daily_digest, weekly_reflect, type_evolution)
-- memory_extraction_cron already exists from 002_settings.sql

ALTER TABLE settings ADD COLUMN IF NOT EXISTS daily_digest_cron TEXT DEFAULT '0 7 * * *';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS weekly_review_cron TEXT DEFAULT '0 18 * * 0';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS type_evolution_cron TEXT DEFAULT '0 10 1 * *';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS daily_digest_model TEXT DEFAULT 'claude-haiku-4-5-20251001';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS weekly_review_model TEXT DEFAULT 'claude-haiku-4-5-20251001';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS type_evolution_model TEXT DEFAULT 'claude-haiku-4-5-20251001';
