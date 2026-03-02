-- Composite index for time-bounded aggregation queries (metrics dashboard)
CREATE INDEX IF NOT EXISTS idx_task_runs_created_status
  ON task_runs (created_at DESC, status);
