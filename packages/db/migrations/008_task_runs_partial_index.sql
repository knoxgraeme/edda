DROP INDEX IF EXISTS idx_task_runs_created_status;

CREATE INDEX IF NOT EXISTS idx_task_runs_terminal_created
  ON task_runs (status, created_at)
  WHERE status IN ('completed', 'failed', 'cancelled');
