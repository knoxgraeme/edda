-- Composite indexes for dashboard queries and common lookups

-- Safe date cast function for JSONB expression indexes
CREATE OR REPLACE FUNCTION safe_date(text) RETURNS date AS $$
BEGIN
  RETURN $1::date;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Dashboard: items by status + type (confirmed only)
CREATE INDEX IF NOT EXISTS idx_items_status_type ON items (status, type)
  WHERE confirmed = true;

-- Dashboard: day descending with type for daily views
CREATE INDEX IF NOT EXISTS idx_items_day_type ON items (day DESC, type)
  WHERE confirmed = true;

-- Due date lookups from metadata JSONB (using safe cast)
CREATE INDEX IF NOT EXISTS idx_items_due_date ON items (
  safe_date(metadata->>'due_date')
) WHERE metadata->>'due_date' IS NOT NULL AND confirmed = true;

-- List lookups by list_name + status
CREATE INDEX IF NOT EXISTS idx_items_list ON items (
  (metadata->>'list_name'), status
) WHERE metadata->>'list_name' IS NOT NULL AND confirmed = true;

-- Pending confirmations
CREATE INDEX IF NOT EXISTS idx_items_pending ON items (created_at DESC)
  WHERE confirmed = false;

CREATE INDEX IF NOT EXISTS idx_entities_pending ON entities (created_at DESC)
  WHERE confirmed = false;
