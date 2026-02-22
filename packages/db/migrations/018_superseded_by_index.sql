-- Partial index for fast lookup of active, non-superseded items by type
CREATE INDEX IF NOT EXISTS idx_items_active_unsuperseded
  ON items (type)
  WHERE superseded_by IS NULL AND confirmed = true;
