-- Add agent_name to thread_metadata for per-agent thread scoping
ALTER TABLE thread_metadata ADD COLUMN agent_name TEXT;

CREATE INDEX idx_thread_metadata_agent ON thread_metadata(agent_name, updated_at DESC)
  WHERE agent_name IS NOT NULL;

-- Backfill existing agent threads (task-{name}-... format)
UPDATE thread_metadata
SET agent_name = substring(thread_id FROM '^task-([^-]+)')
WHERE agent_name IS NULL AND thread_id LIKE 'task-%';
