-- Thread metadata — lightweight tracking for post-processing hooks.
-- Decoupled from the LangGraph checkpointer's internal tables.

CREATE TABLE IF NOT EXISTS thread_metadata (
  thread_id TEXT PRIMARY KEY,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_thread_metadata_unprocessed ON thread_metadata (updated_at DESC)
  WHERE (metadata->>'processed_by_hook')::boolean IS NOT TRUE;
