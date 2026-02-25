CREATE INDEX IF NOT EXISTS idx_items_metadata_created_by
ON items ((metadata->>'created_by'))
WHERE metadata->>'created_by' IS NOT NULL;
