-- Entity indexes that depend on confirmed column (added in 010)

CREATE INDEX IF NOT EXISTS idx_entities_pending ON entities (created_at DESC)
  WHERE confirmed = false;
