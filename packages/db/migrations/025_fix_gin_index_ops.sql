-- Fix: jsonb_path_ops does not support the ?| (exists-any) operator used in scope filtering.
-- Replace with default jsonb_ops which supports both @> and ?| operators.
DROP INDEX IF EXISTS idx_items_metadata_gin;
CREATE INDEX idx_items_metadata_gin ON items USING GIN (metadata);
