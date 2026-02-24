-- Phase 3: Memory Simplification — drop redundant tables and columns
--
-- memory_types and agent_log are replaced by entity profile tool and task_runs.
-- memory_sync settings columns are no longer needed.

DROP TABLE IF EXISTS memory_types CASCADE;
DROP TABLE IF EXISTS agent_log CASCADE;

ALTER TABLE settings
  DROP COLUMN IF EXISTS memory_sync_cron,
  DROP COLUMN IF EXISTS memory_sync_model,
  DROP COLUMN IF EXISTS memory_file_activity_threshold,
  DROP COLUMN IF EXISTS memory_file_stale_days;
