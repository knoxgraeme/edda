-- Main items table — everything the user captures

CREATE TABLE items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type TEXT NOT NULL REFERENCES item_types(name),
  content TEXT NOT NULL,
  summary TEXT,
  metadata JSONB DEFAULT '{}',
  status TEXT DEFAULT 'active'
    CHECK (status IN ('active', 'done', 'archived', 'snoozed')),
  source TEXT DEFAULT 'chat'
    CHECK (source IN ('chat', 'cli', 'api', 'cron', 'agent', 'posthook')),
  day DATE DEFAULT CURRENT_DATE,
  confirmed BOOLEAN DEFAULT true,
  parent_id UUID REFERENCES items(id),
  embedding vector(1024),
  last_reinforced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_items_type ON items(type);
CREATE INDEX idx_items_status ON items(status);
CREATE INDEX idx_items_day ON items(day);
CREATE INDEX idx_items_confirmed ON items(confirmed);
CREATE INDEX idx_items_parent ON items(parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX idx_items_embedding ON items USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
