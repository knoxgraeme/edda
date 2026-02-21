-- Dynamic item type registry

CREATE TABLE item_types (
  name TEXT PRIMARY KEY,
  icon TEXT NOT NULL DEFAULT '📝',
  description TEXT NOT NULL,
  metadata_schema JSONB DEFAULT '{}',
  classification_hint TEXT NOT NULL,
  is_user_created BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
