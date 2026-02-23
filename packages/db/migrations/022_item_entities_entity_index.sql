-- Reverse index for entity_id lookups on composite PK (item_id, entity_id)
CREATE INDEX IF NOT EXISTS idx_item_entities_entity_id
  ON item_entities (entity_id);
