ALTER TABLE settings
ADD COLUMN task_run_retention_days INT NOT NULL DEFAULT 90
  CHECK (task_run_retention_days >= 1 AND task_run_retention_days <= 3650);
