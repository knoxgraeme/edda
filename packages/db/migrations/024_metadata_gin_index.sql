-- Support scope-based search filtering (metadata->'scopes' ?| array, metadata->>'agent' = value)
CREATE INDEX IF NOT EXISTS idx_items_metadata_gin ON items USING GIN (metadata jsonb_path_ops);
