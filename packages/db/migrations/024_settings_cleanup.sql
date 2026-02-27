-- 024_settings_cleanup.sql
-- Remove dead settings columns, replace model_settings_key indirection with direct model column on agents.
-- DESTRUCTIVE: drops columns intentionally — reviewed and approved as part of settings cleanup plan.

-- 1. Add model column to agents, backfill from settings
ALTER TABLE agents ADD COLUMN model TEXT;

UPDATE agents SET model = CASE
  WHEN model_settings_key = 'context_refresh_model'  THEN (SELECT context_refresh_model FROM settings LIMIT 1)
  WHEN model_settings_key = 'memory_catchup_model'   THEN (SELECT memory_catchup_model FROM settings LIMIT 1)
  ELSE (SELECT default_model FROM settings LIMIT 1)
END;

ALTER TABLE agents ALTER COLUMN model SET NOT NULL;
ALTER TABLE agents DROP COLUMN model_settings_key;

-- 2. Drop dead settings columns
ALTER TABLE settings
  DROP COLUMN memory_catchup_cron,
  DROP COLUMN memory_catchup_model,
  DROP COLUMN memory_reinforce_threshold,
  DROP COLUMN memory_update_threshold,
  DROP COLUMN entity_exact_threshold,
  DROP COLUMN entity_fuzzy_threshold,
  DROP COLUMN tool_call_limit_global,
  DROP COLUMN tool_call_limit_delete,
  DROP COLUMN tool_call_limit_archive,
  DROP COLUMN daily_digest_cron,
  DROP COLUMN weekly_review_cron,
  DROP COLUMN type_evolution_cron,
  DROP COLUMN context_refresh_cron,
  DROP COLUMN context_refresh_model;

-- 3. Update defaults: model, search, cron_runner naming
ALTER TABLE settings ALTER COLUMN default_model SET DEFAULT 'claude-sonnet-4-6';
UPDATE settings SET default_model = 'claude-sonnet-4-6';

ALTER TABLE settings ALTER COLUMN search_provider SET DEFAULT 'duckduckgo';
UPDATE settings SET search_provider = 'duckduckgo';

-- Rename cron_runner value: 'standalone' → 'local'
UPDATE settings SET cron_runner = 'local' WHERE cron_runner = 'standalone';
ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_cron_runner_check;
ALTER TABLE settings ADD CONSTRAINT settings_cron_runner_check CHECK (cron_runner IN ('local', 'platform'));
ALTER TABLE settings ALTER COLUMN cron_runner SET DEFAULT 'local';
