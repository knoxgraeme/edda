-- Replace non-unique index with unique index for ON CONFLICT (name) in upsertEntity
DROP INDEX IF EXISTS idx_entities_name;
CREATE UNIQUE INDEX IF NOT EXISTS idx_entities_name_unique ON entities (name);
