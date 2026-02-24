-- Migration 027: Task runs composite index + NOT NULL constraints
--
-- Fixes:
-- 1. Add composite index for getRecentTaskRuns(agent_name) queries
-- 2. Add NOT NULL constraints on timestamp columns that should never be null

-- Composite index for the most common query pattern:
-- SELECT ... FROM task_runs WHERE agent_name = $1 ORDER BY created_at DESC LIMIT N
CREATE INDEX IF NOT EXISTS idx_task_runs_agent_created
  ON task_runs(agent_name, created_at DESC);

-- Enforce NOT NULL on timestamp columns (TypeScript types expect string, not string | null)
ALTER TABLE agent_definitions ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE agent_definitions ALTER COLUMN updated_at SET NOT NULL;
ALTER TABLE task_runs ALTER COLUMN created_at SET NOT NULL;
