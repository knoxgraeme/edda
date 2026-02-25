CREATE INDEX IF NOT EXISTS idx_items_list_normalized_name
ON items ((metadata->>'normalized_name'))
WHERE type = 'list' AND status = 'active';
