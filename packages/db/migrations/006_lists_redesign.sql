-- Lists Redesign Phase 1: First-class lists table + item type cleanup
--
-- Promotes lists from "items with type=list" to a dedicated organizational
-- primitive. Items belong to lists via list_id FK instead of parent_id.

-- ════════════════════════════════════════════════════════════════
-- Lists table
-- ════════════════════════════════════════════════════════════════

CREATE TABLE lists (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  normalized_name TEXT UNIQUE NOT NULL,
  summary TEXT,
  icon TEXT DEFAULT '📋',
  list_type TEXT NOT NULL DEFAULT 'rolling'
    CHECK (list_type IN ('rolling', 'one_off')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  embedding vector(1024),
  embedding_model TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_lists_status ON lists(status);
CREATE INDEX idx_lists_normalized_name ON lists(normalized_name);
CREATE INDEX idx_lists_embedding ON lists
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);

CREATE TRIGGER lists_updated_at
  BEFORE UPDATE ON lists
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ════════════════════════════════════════════════════════════════
-- Add list_id to items
-- ════════════════════════════════════════════════════════════════

ALTER TABLE items ADD COLUMN list_id UUID REFERENCES lists(id) ON DELETE SET NULL;
CREATE INDEX idx_items_list ON items(list_id) WHERE list_id IS NOT NULL;

-- ════════════════════════════════════════════════════════════════
-- Remove old list-as-item index
-- ════════════════════════════════════════════════════════════════

DROP INDEX IF EXISTS idx_items_list_normalized_name;

-- ════════════════════════════════════════════════════════════════
-- Remove organizational item types (replaced by lists table)
-- ════════════════════════════════════════════════════════════════

DELETE FROM item_types WHERE name IN ('list', 'list_item', 'recommendation', 'link', 'idea');

-- ════════════════════════════════════════════════════════════════
-- Update note classification hint to absorb former types
-- ════════════════════════════════════════════════════════════════

UPDATE item_types
SET classification_hint = 'Default type for informational content. Use for observations, recommendations, links, ideas, or anything that doesn''t fit a more specific behavioral type. When the user shares a recommendation, save it as a note with metadata (recommended_by, category). When saving a URL, use a note with metadata (url, title). Prefer a more specific behavioral type (task, reminder, event) when the item has a distinct lifecycle.'
WHERE name = 'note';
