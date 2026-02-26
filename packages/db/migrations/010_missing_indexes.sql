-- Add missing indexes for query performance
-- Todo 073: Partial index on active unsuperseded items
CREATE INDEX IF NOT EXISTS idx_items_active_unsuperseded
  ON items (type, confirmed)
  WHERE superseded_by IS NULL AND confirmed = true;

-- Todo 106: Reverse index on item_entities(entity_id) for entity-based lookups
CREATE INDEX IF NOT EXISTS idx_item_entities_entity_id
  ON item_entities (entity_id);
