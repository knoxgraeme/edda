-- Migration 013: cron runner modes + agent_schedules last_fired_at
--
-- Adds support for an `http_trigger` cron runner mode so the server no longer
-- has to own the clock. In http_trigger mode, an external scheduler (pg_cron,
-- Railway Cron Jobs, GitHub Actions, etc.) pokes POST /api/cron/tick when
-- there's work to do. The server is purely reactive and can scale to zero.
--
-- Also:
--   * Renames the existing `local` value to `in_process` for clarity.
--     `local` and `in_process` mean the same thing; `in_process` better
--     describes "the node-cron timer lives inside the server process".
--   * Adds `last_fired_at` to `agent_schedules` so the http_trigger code path
--     can compute "has this schedule fired since the last scheduled time?"
--     using cron-parser in userland. The in_process (node-cron) path also
--     writes to this column on every fire, so switching modes at runtime is
--     safe.

-- ── 1. Rename the legacy `local` value to `in_process` ────────────
--
-- Both mean "run the node-cron timer inside the server process".
-- Do the UPDATE before touching the CHECK constraint so existing rows
-- are valid under both the old and new constraints.
ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_cron_runner_check;
UPDATE settings SET cron_runner = 'in_process' WHERE cron_runner = 'local';
ALTER TABLE settings ALTER COLUMN cron_runner SET DEFAULT 'in_process';
ALTER TABLE settings ADD CONSTRAINT settings_cron_runner_check
  CHECK (cron_runner IN ('in_process', 'http_trigger', 'langgraph'));

-- ── 2. agent_schedules.last_fired_at ────────────────────────────
--
-- NOT NULL with DEFAULT now() means:
--   * Existing rows get "now" at migration time → on the next tick, we only
--     fire schedules whose next cron time has passed, not the whole world.
--   * New rows get "now" at insert → same behavior.
ALTER TABLE agent_schedules
  ADD COLUMN IF NOT EXISTS last_fired_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Index to let getEnabledSchedules() stay cheap even with many schedules.
CREATE INDEX IF NOT EXISTS idx_agent_schedules_enabled_last_fired
  ON agent_schedules (enabled, last_fired_at)
  WHERE enabled = true;
